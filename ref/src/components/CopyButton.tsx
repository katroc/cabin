import React from 'react';
import { Icon } from './Icon';

interface CopyButtonProps {
  text: string;
}

export const CopyButton: React.FC<CopyButtonProps> = ({ text }) => {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch (e) {
      // noop; we could surface an error toast in future
    }
  };

  return (
    <div className="copy-controls">
      <button
        className="copy-button"
        onClick={handleCopy}
        title={copied ? 'Copied' : 'Copy code'}
        aria-label={copied ? 'Copied' : 'Copy code'}
      >
        {copied ? <Icon name="check-circle" size={14} /> : <Icon name="clipboard" />}
      </button>
      {copied && <span className="copy-toast" role="status">Copied</span>}
    </div>
  );
};