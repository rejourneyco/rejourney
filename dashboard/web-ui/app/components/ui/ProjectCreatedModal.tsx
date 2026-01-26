/**
 * Project Created Success Modal
 * 
 * Shows after successful project creation with project key and AI docs copy functionality
 */

import React, { useState, useCallback } from 'react';
import { Modal } from './Modal';
import { Button } from './Button';
import { Copy, Check, BookOpen, Key, Sparkles, X, ExternalLink } from 'lucide-react';
import { AI_INTEGRATION_PROMPT } from '../../constants/aiPrompts';
import { Project } from '../../types';

interface ProjectCreatedModalProps {
  isOpen: boolean;
  onClose: () => void;
  project: Project | null;
}

export const ProjectCreatedModal: React.FC<ProjectCreatedModalProps> = ({
  isOpen,
  onClose,
  project
}) => {
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedDocs, setCopiedDocs] = useState(false);

  // Copy handlers - same logic as TopBar
  const handleCopyPublicKey = useCallback(() => {
    if (project?.publicKey) {
      navigator.clipboard.writeText(project.publicKey);
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    }
  }, [project?.publicKey]);

  const handleCopyDocsUrl = useCallback(() => {
    navigator.clipboard.writeText(AI_INTEGRATION_PROMPT);
    setCopiedDocs(true);
    setTimeout(() => setCopiedDocs(false), 2000);
  }, []);

  if (!project) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title=""
      size="lg"
      showCloseButton={false}
    >
      <div className="p-8">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 mx-auto mb-4 bg-emerald-100 border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] flex items-center justify-center">
            <Check className="w-8 h-8 text-emerald-600" />
          </div>
          <h2 className="text-2xl font-black text-black mb-2 uppercase tracking-tight">
            Project Created Successfully!
          </h2>
          <p className="text-sm text-slate-600 font-medium">
            Your project <span className="font-black text-black">{project.name}</span> is ready to start monitoring.
          </p>
        </div>

        {/* Project Key Section */}
        <div className="bg-slate-50 border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] p-6 mb-6">
          <div className="flex items-center gap-3 mb-4">
            <Key className="w-5 h-5 text-slate-700" />
            <h3 className="text-sm font-black uppercase text-slate-900 tracking-wider">
              Project Public Key
            </h3>
          </div>

          <div className="bg-white border-2 border-slate-300 p-4 mb-4 font-mono text-sm break-all">
            {project.publicKey}
          </div>

          <button
            onClick={handleCopyPublicKey}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-white border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none transition-all font-black uppercase text-sm tracking-wider"
          >
            {copiedKey ? (
              <>
                <Check className="w-4 h-4 text-emerald-600" />
                <span className="text-emerald-600">Copied to Clipboard!</span>
              </>
            ) : (
              <>
                <Copy className="w-4 h-4" />
                Copy Project Key
              </>
            )}
          </button>
        </div>

        {/* AI Integration Section */}
        <div className="bg-gradient-to-br from-indigo-50 to-purple-50 border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] p-6 mb-8">
          <div className="flex items-center gap-3 mb-4">
            <Sparkles className="w-5 h-5 text-indigo-600" />
            <h3 className="text-sm font-black uppercase text-slate-900 tracking-wider">
              AI Prompt
            </h3>
          </div>

          <p className="text-sm text-slate-600 mb-4 font-medium">
            Get instant setup instructions with your project key already included. Perfect for pasting into AI assistants like ChatGPT, Claude, or Cursor.
          </p>

          <button
            onClick={handleCopyDocsUrl}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-indigo-600 text-white border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none transition-all font-black uppercase text-sm tracking-wider hover:bg-indigo-700"
          >
            {copiedDocs ? (
              <>
                <Check className="w-4 h-4" />
                AI Prompt Copied!
              </>
            ) : (
              <>
                <BookOpen className="w-4 h-4" />
                Copy AI Prompt
              </>
            )}
          </button>
        </div>

        {/* Next Steps */}
        <div className="bg-amber-50 border-2 border-amber-300 p-4 mb-6">
          <h4 className="text-xs font-black uppercase text-amber-800 mb-2 tracking-wider">
            Next Steps:
          </h4>
          <ol className="text-sm text-amber-700 space-y-1 font-medium">
            <li>1. Install the React Native SDK in your app</li>
            <li>2. Run `npm install @rejourneyco/react-native` in your terminal</li>
            <li>3. Use the AI prompt to get started or view the docs.</li>
            <li>4. You can start observing your user's sessions.</li>
          </ol>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-4">
          <Button
            variant="secondary"
            onClick={onClose}
            className="flex-1 border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none transition-all font-black uppercase"
          >
            <X className="w-4 h-4 mr-2" />
            Close
          </Button>
          <Button
            variant="primary"
            onClick={() => window.open('/docs', '_blank')}
            className="flex-1 bg-black text-white border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none transition-all font-black uppercase"
          >
            <ExternalLink className="w-4 h-4 mr-2" />
            View Full Docs
          </Button>
        </div>
      </div>
    </Modal>
  );
};