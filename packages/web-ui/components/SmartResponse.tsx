'use client'

import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';

interface Citation {
  id: string;
  page_title: string;
  space_name?: string;
  source_url?: string;
  page_section?: string;
  last_modified?: string;
}

interface SmartResponseProps {
  answer: string;
  query: string;
  citations?: Citation[];
  animate?: boolean;
  isVerifyingSources?: boolean;
  isStreaming?: boolean;
}

type QueryType = 'factual' | 'howto' | 'troubleshooting' | 'comparison' | 'general';

interface ResponseSection {
  type: string;
  content: string;
  icon?: string;
}

const slugify = (value: string): string => {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
};

const getNodeText = (node: any): string => {
  if (!node) {
    return '';
  }

  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }

  if (Array.isArray(node)) {
    return node.map(getNodeText).join('');
  }

  if (typeof node === 'object') {
    if ('value' in node && typeof node.value !== 'undefined') {
      return String(node.value);
    }

    if ('children' in node && Array.isArray((node as any).children)) {
      return (node as any).children.map(getNodeText).join('');
    }

    if ('props' in node && (node as any).props?.children) {
      return getNodeText((node as any).props.children);
    }
  }

  return '';
};

const SmartResponse: React.FC<SmartResponseProps> = ({
  answer,
  query,
  citations = [],
  animate = false,
  isVerifyingSources = false,
  isStreaming = false
}) => {
  const [displayedAnswer, setDisplayedAnswer] = React.useState(animate ? '' : answer);
  const [isAnimating, setIsAnimating] = React.useState(animate);
  const containerRef = React.useRef<HTMLDivElement | null>(null);

  // Animation effect
  React.useEffect(() => {
    if (!animate || !answer) {
      setDisplayedAnswer(answer);
      setIsAnimating(false);
      return;
    }

    setDisplayedAnswer('');
    setIsAnimating(true);

    let currentIndex = 0;
    const speed = 30; // milliseconds per chunk
    const chunkSize = 8; // characters per chunk

    const interval = setInterval(() => {
      if (currentIndex >= answer.length) {
        setDisplayedAnswer(answer);
        setIsAnimating(false);
        clearInterval(interval);
        return;
      }

      // Reveal text in chunks
      currentIndex = Math.min(currentIndex + chunkSize, answer.length);
      setDisplayedAnswer(answer.slice(0, currentIndex));
    }, speed);

    return () => clearInterval(interval);
  }, [answer, animate]);

  // Detect query type based on patterns
  const detectQueryType = (query: string): QueryType => {
    const q = query.toLowerCase();

    if (q.includes('how to') || q.includes('how do') || q.includes('how can')) {
      return 'howto';
    }

    if (q.includes('issue') || q.includes('problem') || q.includes('error') || q.includes('fix') || q.includes('troubleshoot')) {
      return 'troubleshooting';
    }

    if (q.includes('difference') || q.includes('compare') || q.includes('vs') || q.includes('versus')) {
      return 'comparison';
    }

    if (q.includes('what is') || q.includes('what are') || q.includes('define') || q.includes('explain')) {
      return 'factual';
    }

    return 'general';
  };

  // Parse and structure the response based on type
  const parseResponse = (answer: string, type: QueryType): ResponseSection[] => {
    const sections: ResponseSection[] = [];

    // For troubleshooting, look for problem/solution structure
    if (type === 'troubleshooting') {
      const lines = answer.split('\n');
      let currentSection = '';
      let currentContent: string[] = [];

      for (const line of lines) {
        if (line.toLowerCase().includes('problem:') || line.toLowerCase().includes('issue:')) {
          if (currentSection) {
            sections.push({ type: currentSection, content: currentContent.join('\n') });
          }
          currentSection = 'problem';
          currentContent = [line];
        } else if (line.toLowerCase().includes('solution:') || line.toLowerCase().includes('fix:')) {
          if (currentSection) {
            sections.push({ type: currentSection, content: currentContent.join('\n') });
          }
          currentSection = 'solution';
          currentContent = [line];
        } else {
          currentContent.push(line);
        }
      }

      if (currentSection) {
        sections.push({ type: currentSection, content: currentContent.join('\n') });
      }
    }

    // If no special structure detected, return as single section
    if (sections.length === 0) {
      sections.push({ type: 'main', content: answer });
    }

    return sections;
  };

  // Get appropriate wrapper class for query type
  const getResponseClass = (type: QueryType): string => {
    switch (type) {
      case 'troubleshooting': return 'response-troubleshooting';
      case 'howto': return 'response-howto';
      case 'factual': return 'response-factual';
      case 'comparison': return 'response-comparison';
      default: return 'response-general';
    }
  };

  const queryType = detectQueryType(query);

  // Map unicode superscript digits to their numeric equivalents
  const superscriptMap: Record<string, string> = {
    '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9'
  };

  const renderCitationPill = (num: string, key: string | number) => {
    const cite = citations.find(c => String(c.id) === String(num));
    const title = cite?.page_title || `Source ${num}`;
    return (
      <span key={`cite-pill-${key}`} className="citation-pill-inline" data-cite={num}>
        <a
          href={`#src-${num}`}
          aria-label={`Jump to source ${num}`}
          title={title}
        >
          {num}
        </a>
      </span>
    );
  };

  // Transform any inline citation markers into clickable pills
  const renderWithCitations = (children: React.ReactNode): React.ReactNode => {
    const transform = (node: React.ReactNode): React.ReactNode => {
      if (typeof node === 'string') {
        const parts = node.split(/(\[\d+\]|[¹²³⁴⁵⁶⁷⁸⁹])/g);
        return parts.map((part, idx) => {
          const num = superscriptMap[part as keyof typeof superscriptMap];
          if (num) {
            return renderCitationPill(num, `${idx}-${num}-sup`);
          }

          const bracketMatch = part.match(/^\[(\d+)\]$/);
          if (bracketMatch) {
            const bracketNum = bracketMatch[1];
            return renderCitationPill(bracketNum, `${idx}-${bracketNum}-bracket`);
          }
          return part;
        });
      }
      if (Array.isArray(node)) return node.map((n, i) => <React.Fragment key={i}>{transform(n)}</React.Fragment>);
      if (React.isValidElement(node) && (node.props as any)?.children) {
        return React.cloneElement(node as React.ReactElement, {
          children: transform((node.props as any).children)
        });
      }
      return node;
    };
    return transform(children);
  };

  // Handle click on inline citation to smooth scroll + temporary highlight the target source
  const onContentClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const anchor = target.closest('a');
    if (!anchor) return;
    const href = anchor.getAttribute('href');
    if (href && href.startsWith('#src-')) {
      e.preventDefault();
      const id = href.slice(1);
      const el = document.getElementById(id);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('citation-highlight');
        window.setTimeout(() => el.classList.remove('citation-highlight'), 1400);
        history.replaceState(null, '', href);
      }
    }
  };

  const sections = parseResponse(displayedAnswer, queryType);

  const headingCounterRef = React.useRef<Map<string, number>>(new Map());
  const previousAnswerRef = React.useRef<string | null>(null);

  if (previousAnswerRef.current !== displayedAnswer) {
    headingCounterRef.current = new Map();
    previousAnswerRef.current = displayedAnswer;
  }

  const getHeadingId = React.useCallback(
    (text: string) => {
      const map = headingCounterRef.current;
      const base = slugify(text);
      const count = map.get(base) ?? 0;
      map.set(base, count + 1);
      return count === 0 ? base : `${base}-${count}`;
    },
    []
  );

  const headings = React.useMemo(() => {
    if (!displayedAnswer) return [] as { depth: number; text: string; id: string }[];
    const headingRegex = /^(#{1,4})\s+(.+)$/gm;
    const slugCounts = new Map<string, number>();
    const collected: { depth: number; text: string; id: string }[] = [];
    let match: RegExpExecArray | null;

    while ((match = headingRegex.exec(displayedAnswer)) !== null) {
      const hashes = match[1];
      const text = match[2].trim();
      if (!text) continue;

      const depth = hashes.length;
      const base = slugify(text);
      const count = slugCounts.get(base) ?? 0;
      slugCounts.set(base, count + 1);
      const id = count === 0 ? base : `${base}-${count}`;
      collected.push({ depth, text, id });
    }

    return collected;
  }, [displayedAnswer]);

  const headingComponents = {
    h1: ({ node, children }: any) => {
      const text = getNodeText(node);
      const id = getHeadingId(text);
      return (
        <h1 id={id} className="response-h1">
          {renderWithCitations(children)}
        </h1>
      );
    },
    h2: ({ node, children }: any) => {
      const text = getNodeText(node);
      const id = getHeadingId(text);
      return (
        <h2 id={id} className="response-h2">
          {renderWithCitations(children)}
        </h2>
      );
    },
    h3: ({ node, children }: any) => {
      const text = getNodeText(node);
      const id = getHeadingId(text);
      return (
        <h3 id={id} className="response-h3">
          {renderWithCitations(children)}
        </h3>
      );
    },
    h4: ({ node, children }: any) => {
      const text = getNodeText(node);
      const id = getHeadingId(text);
      return (
        <h4 id={id} className="response-h4">
          {renderWithCitations(children)}
        </h4>
      );
    }
  };

  const listComponents = {
    ol: ({ children }: any) => <ol className="ordered-list">{renderWithCitations(children)}</ol>,
    ul: ({ children }: any) => <ul className="unordered-list">{renderWithCitations(children)}</ul>,
    li: ({ node, children }: any) => {
      if (typeof (node as any)?.checked === 'boolean') {
        const checked = Boolean((node as any).checked);
        return (
          <li className="checkbox-item">
            <span className="checkbox-icon">{checked ? '✓' : ''}</span>
            <span>{renderWithCitations(children)}</span>
          </li>
        );
      }
      return <li className="list-item">{renderWithCitations(children)}</li>;
    }
  };

  return (
    <div ref={containerRef} className={`smart-response ${getResponseClass(queryType)}`}>
      {/* Main content */}
      <div className={`response-content ${isStreaming ? 'streaming-content' : ''}`} onClick={onContentClick}>
        {headings.length > 1 && (
          <nav className="response-toc">
            <div className="response-toc-title">On this page</div>
            <div className="response-toc-list">
              {headings.map((heading) => (
                <a key={heading.id} href={`#${heading.id}`} data-depth={heading.depth}>
                  <span>{heading.text}</span>
                </a>
              ))}
            </div>
          </nav>
        )}

        {sections.map((section, index) => (
          <div key={index} className={`response-section section-${section.type}`}>
            {section.type !== 'main' && (
              <div className="section-header">
                <span className="section-title">{section.type.toUpperCase()}</span>
              </div>
            )}
            <div className="section-body">
              <ReactMarkdown
                className="markdown-body"
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeRaw]}
                components={{
                  // Headings & structure
                  ...headingComponents,

                  // Paragraphs
                  p: ({ children }) => <p>{renderWithCitations(children)}</p>,

                  // Lists
                  ...listComponents,

                  // Custom rendering for different elements
                  code: ({ children, className }) => {
                    const isInline = !className;
                    return isInline ? (
                      <code className="inline-code">{children}</code>
                    ) : (
                      <div className="code-block-wrapper">
                        <pre className={className}>
                          <code>{children}</code>
                        </pre>
                      </div>
                    );
                  },

                  // Enhanced emphasis
                  strong: ({ children }) => <strong className="text-bold">{children}</strong>,
                  em: ({ children }) => <em className="text-italic">{children}</em>,

                  // Blockquotes as callouts
                  blockquote: ({ children }) => (
                    <div className="callout callout-info">
                      <div className="callout-icon">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/>
                        </svg>
                      </div>
                      <div className="callout-content">{children}</div>
                    </div>
                  ),

                  // Enhanced links
                  a: ({ href, children }) => (
                    <a href={href} className="response-link" target="_blank" rel="noopener noreferrer">
                      {children}
                      <span className="link-icon">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/>
                        </svg>
                      </span>
                    </a>
                  ),

                  table: ({ node, children }: any) => {
                    const headerRow = node?.children?.[0];
                    const headerLabels = headerRow?.children?.map((cell: any) => getNodeText(cell).toLowerCase()) ?? [];
                    const metricIndex = headerLabels.indexOf('metric');
                    const valueIndex = headerLabels.indexOf('value');
                    if (metricIndex !== -1 && valueIndex !== -1 && node?.children?.length > 1) {
                      const metricRows = node.children.slice(1);
                      return (
                        <div className="markdown-body metric-grid">
                          {metricRows.map((row: any, rowIndex: number) => {
                            const cells = row.children ?? [];
                            const metricLabel = cells[metricIndex] ? getNodeText(cells[metricIndex]) : '';
                            const metricValue = cells[valueIndex] ? getNodeText(cells[valueIndex]) : '';
                            const captionCell = cells.find((_: any, idx: number) => idx !== metricIndex && idx !== valueIndex);
                            const captionText = captionCell ? getNodeText(captionCell) : '';
                            return (
                              <div key={`metric-${rowIndex}`} className="metric-card">
                                <div className="metric-card-title">{metricLabel}</div>
                                <div className="metric-card-value">{metricValue}</div>
                                {captionText && <div className="metric-card-caption">{captionText}</div>}
                              </div>
                            );
                          })}
                        </div>
                      );
                    }

                    return (
                      <div className="table-scroll">
                        <table>{children}</table>
                      </div>
                    );
                  },
                }}
              >
                {section.content}
              </ReactMarkdown>
              {(isAnimating || isStreaming) && index === sections.length - 1 && (
                <span className="streaming-cursor"></span>
              )}
            </div>
          </div>
        ))}

        {/* Citations Section */}
        {((citations && citations.length > 0) || isVerifyingSources) && (
          <div className="citations-section">
            <div className="citations-header">
              {isVerifyingSources ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="citations-icon citations-loading">
                  <path d="M12,4V2A10,10 0 0,0 2,12H4A8,8 0 0,1 12,4Z" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="citations-icon">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
                </svg>
              )}
              <span className="citations-title">
                {isVerifyingSources ? "Verifying sources..." : "Sources"}
              </span>
            </div>
            <div className="citations-list">
              {isVerifyingSources && citations.length === 0 ? (
                <div className="citation-item citation-verifying">
                  <div className="citation-verifying-content">
                    <div className="citation-verifying-dots">
                      <span>●</span>
                      <span>●</span>
                      <span>●</span>
                    </div>
                    <div className="citation-verifying-text">Checking source reliability...</div>
                  </div>
                </div>
              ) : (
                citations.map((citation) => (
                <div key={citation.id} id={`src-${citation.id}`} className="citation-item">
                  <div className="citation-id">{citation.id}</div>
                  <div className="citation-content">
                    <div className="citation-title">{citation.page_title}</div>
                    {citation.space_name && (
                      <div className="citation-space">Space: {citation.space_name}</div>
                    )}
                    {citation.page_section && (
                      <div className="citation-section">Section: {citation.page_section}</div>
                    )}
                    {citation.source_url && (
                      <a
                        href={citation.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="citation-link"
                      >
                        View Source
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/>
                        </svg>
                      </a>
                    )}
                    {citation.last_modified && (
                      <div className="citation-date">
                        Last modified: {new Date(citation.last_modified).toLocaleDateString()}
                      </div>
                    )}
                  </div>
                </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SmartResponse;
