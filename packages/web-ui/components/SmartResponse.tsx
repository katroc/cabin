'use client'

import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface SmartResponseProps {
  answer: string;
  query: string;
  animate?: boolean;
}

type QueryType = 'factual' | 'howto' | 'troubleshooting' | 'comparison' | 'general';

interface ResponseSection {
  type: string;
  content: string;
  icon?: string;
}

export const SmartResponse: React.FC<SmartResponseProps> = ({
  answer,
  query,
  animate = false
}) => {
  const [displayedAnswer, setDisplayedAnswer] = React.useState(animate ? '' : answer);
  const [isAnimating, setIsAnimating] = React.useState(animate);

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
  const sections = parseResponse(displayedAnswer, queryType);

  return (
    <div className={`smart-response ${getResponseClass(queryType)}`}>
      {/* Query type indicator */}
      <div className="response-type-indicator">
        {queryType === 'howto' && (
          <span className="type-badge">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/>
            </svg>
            <span>How-to</span>
          </span>
        )}
        {queryType === 'troubleshooting' && (
          <span className="type-badge">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M22.7 19l-9.1-9.1c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.7C.4 7.1.9 10.1 2.9 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1.1.1-1.4z"/>
            </svg>
            <span>Troubleshooting</span>
          </span>
        )}
        {queryType === 'factual' && (
          <span className="type-badge">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/>
            </svg>
            <span>Information</span>
          </span>
        )}
        {queryType === 'comparison' && (
          <span className="type-badge">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zM7 13.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm5 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm5 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/>
            </svg>
            <span>Comparison</span>
          </span>
        )}
      </div>

      {/* Main content */}
      <div className="response-content">
        {sections.map((section, index) => (
          <div key={index} className={`response-section section-${section.type}`}>
            {section.type !== 'main' && (
              <div className="section-header">
                <span className="section-title">{section.type.toUpperCase()}</span>
              </div>
            )}
            <div className="section-body">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
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

                  // Enhanced list rendering
                  ol: ({ children }) => <ol className="ordered-list">{children}</ol>,
                  ul: ({ children }) => <ul className="unordered-list">{children}</ul>,
                  li: ({ children }) => <li className="list-item">{children}</li>,

                  // Enhanced headings
                  h1: ({ children }) => <h1 className="response-h1">{children}</h1>,
                  h2: ({ children }) => <h2 className="response-h2">{children}</h2>,
                  h3: ({ children }) => <h3 className="response-h3">{children}</h3>,

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
                }}
              >
                {section.content}
              </ReactMarkdown>
              {isAnimating && index === sections.length - 1 && (
                <span className="typewriter-cursor">▊</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};