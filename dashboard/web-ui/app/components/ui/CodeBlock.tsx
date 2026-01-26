import React from 'react';

interface CodeBlockProps {
  code: string;
  language?: string;
}

export const CodeBlock: React.FC<CodeBlockProps> = ({ code, language = 'javascript' }) => {
  // Simple syntax highlighting for JavaScript/TypeScript with premium dark theme colors
  const highlightCode = (code: string): React.ReactNode[] => {
    const lines = code.split('\n');
    return lines.map((line, lineIndex) => {
      // Match import statements: import { initRejourney } from 'rejourney';
      const importMatch = line.match(/^(import\s+)(\{[^}]+\})(\s+from\s+)('[^']+'|"[^"]+");?$/);
      if (importMatch) {
        return (
          <React.Fragment key={lineIndex}>
            <span className="text-[#818cf8]">{importMatch[1]}</span>
            <span className="text-gray-100">{importMatch[2]}</span>
            <span className="text-[#818cf8]">{importMatch[3]}</span>
            <span className="text-[#34d399]">{importMatch[4]}</span>
            {importMatch[0].endsWith(';') && <span className="text-gray-500">;</span>}
          </React.Fragment>
        );
      }

      // Match function calls with string argument: initRejourney('pk_live_public_route_key')
      const funcMatch = line.match(/^(\w+)(\()('[^']+'|"[^"]+")(\));?$/);
      if (funcMatch) {
        return (
          <React.Fragment key={lineIndex}>
            <span className="text-[#38bdf8]">{funcMatch[1]}</span>
            <span className="text-gray-400">{funcMatch[2]}</span>
            <span className="text-[#34d399]">{funcMatch[3]}</span>
            <span className="text-gray-400">{funcMatch[4]}</span>
            {funcMatch[0].endsWith(';') && <span className="text-gray-500">;</span>}
          </React.Fragment>
        );
      }

      // Match function calls with no arguments: startRejourney();
      const noArgFuncMatch = line.match(/^(\w+)(\(\));?$/);
      if (noArgFuncMatch) {
        return (
          <React.Fragment key={lineIndex}>
            <span className="text-[#38bdf8]">{noArgFuncMatch[1]}</span>
            <span className="text-gray-400">{noArgFuncMatch[2]}</span>
            {noArgFuncMatch[0].endsWith(';') && <span className="text-gray-500">;</span>}
          </React.Fragment>
        );
      }

      // Match method calls: Rejourney.setUserIdentity('user_id')
      const methodMatch = line.match(/^(\w+)(\.)([\w.]+)(\()('[^']+'|"[^"]+"|[^)]*)?(\));?$/);
      if (methodMatch) {
        return (
          <React.Fragment key={lineIndex}>
            <span className="text-orange-400">{methodMatch[1]}</span>
            <span className="text-gray-400">{methodMatch[2]}</span>
            <span className="text-[#38bdf8]">{methodMatch[3]}</span>
            <span className="text-gray-400">{methodMatch[4]}</span>
            {methodMatch[5] && (
              methodMatch[5].startsWith("'") || methodMatch[5].startsWith('"')
                ? <span className="text-[#34d399]">{methodMatch[5]}</span>
                : <span className="text-gray-200">{methodMatch[5]}</span>
            )}
            <span className="text-gray-400">{methodMatch[6]}</span>
            {methodMatch[0].endsWith(';') && <span className="text-gray-500">;</span>}
          </React.Fragment>
        );
      }

      // Match comments: // ...
      if (line.trim().startsWith('//')) {
        return (
          <span key={lineIndex} className="text-[#94a3b8] italic">
            {line}
          </span>
        );
      }

      // Fallback: return line as-is
      return (
        <span key={lineIndex} className="text-gray-300">
          {line}
        </span>
      );
    });
  };

  const highlightedLines = highlightCode(code);

  return (
    <div className="overflow-hidden">
      <pre className="text-sm sm:text-base font-mono leading-7 m-0 break-words whitespace-pre-wrap">
        <code className="block">
          {highlightedLines.map((line, idx) => (
            <div key={idx} className="min-h-[1.75rem] break-words">
              {line}
            </div>
          ))}
        </code>
      </pre>
    </div>
  );
};
