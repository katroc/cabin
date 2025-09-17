#!/usr/bin/env python3
"""
Cabin RAG Assistant - Master Startup Script
Starts all required services: ChromaDB, Python Backend, and Web UI
"""

import os
import sys
import subprocess
import signal
import time
import requests
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from typing import Optional
from urllib.parse import urlsplit, urlunsplit
import threading

# Colors for console output
class Colors:
    HEADER = '\033[95m'
    OKBLUE = '\033[94m'
    OKCYAN = '\033[96m'
    OKGREEN = '\033[92m'
    WARNING = '\033[93m'
    FAIL = '\033[91m'
    ENDC = '\033[0m'
    BOLD = '\033[1m'

def print_header(text):
    print(f"\n{Colors.HEADER}{Colors.BOLD}🏠 {text}{Colors.ENDC}")

def print_success(text):
    print(f"{Colors.OKGREEN}✅ {text}{Colors.ENDC}")

def print_info(text):
    print(f"{Colors.OKBLUE}ℹ️  {text}{Colors.ENDC}")

def print_warning(text):
    print(f"{Colors.WARNING}⚠️  {text}{Colors.ENDC}")

def print_error(text):
    print(f"{Colors.FAIL}❌ {text}{Colors.ENDC}")


def load_env_file(path: Path) -> None:
    """Populate os.environ with key/value pairs from a simple .env file."""
    if not path.exists():
        return

    try:
        with path.open('r', encoding='utf-8') as handle:
            for raw in handle:
                line = raw.strip()
                if not line or line.startswith('#') or '=' not in line:
                    continue
                key, value = line.split('=', 1)
                key = key.strip()
                value = value.strip().strip('"').strip("'")
                os.environ.setdefault(key, value)
    except Exception as exc:
        print_warning(f"Failed to load environment file {path}: {exc}")

class ServiceManager:
    def __init__(self):
        self.root_dir = Path(__file__).parent
        self.processes = {}
        self.running = True
        self.reranker_url, self.reranker_port = self._resolve_reranker_endpoint(
            os.environ.get("CABIN_RERANKER_URL") or os.environ.get("RERANKER_URL"),
            os.environ.get("CABIN_RERANKER_PORT")
        )
        self.reranker_api_key = os.environ.get("CABIN_RERANKER_API_KEY") or os.environ.get("RERANKER_API_KEY")

        # Ensure downstream consumers see the resolved values
        os.environ["CABIN_RERANKER_URL"] = self.reranker_url
        os.environ["RERANKER_URL"] = self.reranker_url
        os.environ["CABIN_RERANKER_PORT"] = str(self.reranker_port)

        # Service configurations
        self.services: dict[str, dict] = {}
        self.startup_sequence: list[str] = []

        if self._is_local_endpoint(self.reranker_url):
            self.services['reranker'] = {
                'name': 'Reranker Service',
                'cmd': [
                    sys.executable, '-m', 'uvicorn',
                    'app:app',
                    '--host', '0.0.0.0',
                    '--port', str(self.reranker_port),
                    '--app-dir', 'services/reranker',
                ],
                'cwd': self.root_dir / 'packages' / 'backend-python',
                'health_url': f'http://localhost:{self.reranker_port}/healthz',
                'startup_delay': 8,
                'env': {"RERANKER_API_KEY": self.reranker_api_key} if self.reranker_api_key else {},
            }
            self.startup_sequence.append('reranker')
        else:
            print_info(
                f"External reranker detected at {self.reranker_url}; skipping local sidecar startup."
            )

        self.services['backend'] = {
            'name': 'Python Backend',
            'cmd': [
                sys.executable, '-m', 'uvicorn',
                'cabin_backend.main:app',
                '--host', '0.0.0.0',
                '--port', '8788',
                '--reload',
                '--app-dir', 'src/'
            ],
            'cwd': self.root_dir / 'packages' / 'backend-python',
            'health_url': 'http://localhost:8788/health',
            'startup_delay': 8,
            'env': {
                'RERANKER_URL': self.reranker_url,
                'CABIN_RERANKER_URL': self.reranker_url,
                'CABIN_RERANKER_PORT': str(self.reranker_port),
                **({"RERANKER_API_KEY": self.reranker_api_key} if self.reranker_api_key else {}),
            },
        }
        self.startup_sequence.append('backend')

        self.services['frontend'] = {
            'name': 'Web UI',
            'cmd': ['npm', 'run', 'dev'],
            'cwd': self.root_dir / 'packages' / 'web-ui',
            'health_url': 'http://localhost:3000',
            'startup_delay': 10,
            'env': {},
        }
        self.startup_sequence.append('frontend')

    @staticmethod
    def _resolve_reranker_endpoint(url_override: Optional[str], port_override: Optional[str]) -> tuple[str, int]:
        default_port = 8010

        def parse_port(value: Optional[str]) -> Optional[int]:
            if not value:
                return None
            try:
                return int(value)
            except ValueError:
                print_warning(f"Invalid CABIN_RERANKER_PORT '{value}'. Using default {default_port}.")
                return None

        requested_port = parse_port(port_override) or default_port
        local_hosts = {"localhost", "127.0.0.1", "0.0.0.0"}

        if url_override:
            cleaned = url_override.strip()
            if cleaned:
                cleaned = cleaned.rstrip('/')
                parsed = urlsplit(cleaned)
                if parsed.scheme and parsed.netloc:
                    host = parsed.hostname or 'localhost'
                    path = parsed.path or '/rerank'
                    port_in_url = parsed.port

                    if host not in local_hosts:
                        rebuilt = urlunsplit((
                            parsed.scheme,
                            parsed.netloc,
                            path,
                            parsed.query,
                            parsed.fragment,
                        )).rstrip('/')
                        return rebuilt, port_in_url or requested_port

                    port = port_in_url or requested_port

                    credentials = ''
                    if parsed.username:
                        credentials = parsed.username
                        if parsed.password:
                            credentials += f":{parsed.password}"
                        credentials += '@'
                    netloc = f"{credentials}{host}:{port}"
                    rebuilt = urlunsplit((parsed.scheme, netloc, path, parsed.query, parsed.fragment)).rstrip('/')
                    return rebuilt, port

                print_warning(f"Invalid reranker URL '{url_override}'. Falling back to localhost.")

        return f"http://localhost:{requested_port}/rerank", requested_port

    @staticmethod
    def _is_local_endpoint(url: str) -> bool:
        try:
            host = urlsplit(url).hostname
        except Exception:
            return True
        if host is None:
            return True
        return host in {"localhost", "127.0.0.1", "0.0.0.0"}

    def check_health(self, service_name):
        """Check if a service is healthy"""
        service = self.services[service_name]
        try:
            response = requests.get(service['health_url'], timeout=2)
            return response.status_code == 200
        except:
            return False

    def start_service(self, service_name):
        """Start a single service"""
        service = self.services[service_name]
        print_info(f"Starting {service['name']}...")

        try:
            # Special handling for different services
            env = os.environ.copy()
            env.update(service.get('env', {}))
            cmd = service['cmd'].copy()

            if service_name in ('backend', 'reranker'):
                # Use the cabin-venv virtual environment
                venv_python = self.root_dir / 'cabin-venv' / 'bin' / 'python'
                if venv_python.exists():
                    print_info(f"Using virtual environment: {venv_python}")
                    cmd[0] = str(venv_python)
                else:
                    print_warning(f"Virtual environment not found at {venv_python}, using system Python")

            if service_name == 'backend':
                # Add Python path for backend
                src_path = service['cwd'] / 'src'
                pythonpath = str(src_path)
                if 'PYTHONPATH' in env:
                    env['PYTHONPATH'] = f"{pythonpath}:{env['PYTHONPATH']}"
                else:
                    env['PYTHONPATH'] = pythonpath

            process = subprocess.Popen(
                cmd,
                cwd=service['cwd'],
                env=env,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                universal_newlines=True,
                bufsize=1
            )

            self.processes[service_name] = process

            # Wait for service to start
            time.sleep(service['startup_delay'])

            # Check health
            if self.check_health(service_name):
                print_success(f"{service['name']} started successfully")
                return True
            else:
                print_warning(f"{service['name']} started but health check failed")
                return True  # Continue anyway

        except Exception as e:
            print_error(f"Failed to start {service['name']}: {e}")
            return False

    def stop_services(self):
        """Stop all services gracefully"""
        print_info("Stopping services...")
        self.running = False

        for service_name, process in self.processes.items():
            if process and process.poll() is None:
                print_info(f"Stopping {self.services[service_name]['name']}...")
                try:
                    process.terminate()
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                except:
                    pass

        print_success("All services stopped")

    def monitor_services(self):
        """Monitor service output in a separate thread"""
        def monitor_service(service_name, process):
            service = self.services[service_name]
            try:
                for line in iter(process.stdout.readline, ''):
                    if not self.running:
                        break
                    if line.strip():
                        print(f"[{service['name']}] {line.strip()}")
                    if process.poll() is not None:
                        break
            except:
                pass

        # Start monitoring threads
        for service_name, process in self.processes.items():
            if process:
                thread = threading.Thread(
                    target=monitor_service,
                    args=(service_name, process),
                    daemon=True
                )
                thread.start()

    def run(self):
        """Main run method"""
        print_header("Cabin RAG Assistant Startup")
        print_info("Starting all services...")

        # Setup signal handlers
        def signal_handler(sig, frame):
            print_info("\nShutdown signal received...")
            self.stop_services()
            sys.exit(0)

        signal.signal(signal.SIGINT, signal_handler)
        signal.signal(signal.SIGTERM, signal_handler)

        # Start services in order
        for service_name in self.startup_sequence:
            if not self.start_service(service_name):
                print_error("Failed to start services. Exiting.")
                self.stop_services()
                return 1

        print_header("All Services Started!")
        print_info("Services running at:")
        if 'reranker' in self.services:
            print(f"  🔁 Reranker:    {self.reranker_url} (port {self.reranker_port})")
        else:
            print(f"  🔁 Reranker:    {self.reranker_url} (external)")
        print(f"  🐍 Backend API:  http://localhost:8788")
        print(f"  🌐 Web UI:       http://localhost:3000")
        print()
        print_info("Note: Make sure ChromaDB is running on localhost:8000")
        print()
        print_info("Press Ctrl+C to stop all services")
        print()

        # Start monitoring
        self.monitor_services()

        # Keep running until stopped
        try:
            while self.running:
                time.sleep(1)

                # Check if any processes died
                for service_name, process in list(self.processes.items()):
                    if process and process.poll() is not None:
                        print_error(f"{self.services[service_name]['name']} stopped unexpectedly")
                        self.running = False
                        break

        except KeyboardInterrupt:
            pass

        self.stop_services()
        return 0

def main():
    """Main entry point"""
    # Check if we're in the right directory
    if not (Path.cwd() / 'packages').exists():
        print_error("Please run this script from the cabin project root directory")
        return 1

    # Load project environment variables if present
    load_env_file(Path(__file__).parent / '.env')

    # Check dependencies
    print_info("Checking dependencies...")

    # Check if Node.js/npm is available
    try:
        subprocess.run(['npm', '--version'], capture_output=True, check=True)
        print_success("npm found")
    except:
        print_error("npm not found. Please install Node.js")
        return 1

    default_reranker_port = os.environ.get('CABIN_RERANKER_PORT', '8010')
    default_reranker_url = os.environ.get('CABIN_RERANKER_URL', f'http://localhost:{default_reranker_port}/rerank')
    print_info("Note: Make sure ChromaDB is running separately on localhost:8000")
    print_info(
        "Reranker sidecar will start locally unless CABIN_RERANKER_URL points elsewhere"
    )
    print_info(f"Current reranker target: {default_reranker_url} (port {default_reranker_port})")

    # Start services
    manager = ServiceManager()
    return manager.run()

if __name__ == "__main__":
    sys.exit(main())
