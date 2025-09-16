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

class ServiceManager:
    def __init__(self):
        self.root_dir = Path(__file__).parent
        self.processes = {}
        self.running = True

        # Service configurations
        self.services = {
            'backend': {
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
                'startup_delay': 8
            },
            'frontend': {
                'name': 'Web UI',
                'cmd': ['npm', 'run', 'dev'],
                'cwd': self.root_dir / 'packages' / 'web-ui',
                'health_url': 'http://localhost:3000',
                'startup_delay': 10
            }
        }

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
            cmd = service['cmd'].copy()

            if service_name == 'backend':
                # Use the cabin-venv virtual environment
                venv_python = self.root_dir / 'cabin-venv' / 'bin' / 'python'
                if venv_python.exists():
                    print_info(f"Using virtual environment: {venv_python}")
                    cmd[0] = str(venv_python)
                else:
                    print_warning(f"Virtual environment not found at {venv_python}, using system Python")

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
        for service_name in ['backend', 'frontend']:
            if not self.start_service(service_name):
                print_error("Failed to start services. Exiting.")
                self.stop_services()
                return 1

        print_header("All Services Started!")
        print_info("Services running at:")
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

    # Check dependencies
    print_info("Checking dependencies...")

    # Check if Node.js/npm is available
    try:
        subprocess.run(['npm', '--version'], capture_output=True, check=True)
        print_success("npm found")
    except:
        print_error("npm not found. Please install Node.js")
        return 1

    print_info("Note: Make sure ChromaDB is running separately on localhost:8000")

    # Start services
    manager = ServiceManager()
    return manager.run()

if __name__ == "__main__":
    sys.exit(main())