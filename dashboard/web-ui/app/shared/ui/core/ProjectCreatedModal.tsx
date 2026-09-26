/**
 * Project Created Success Modal
 *
 * Shows after successful project creation with project key and AI prompt copy actions.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { CheckCircle2, Copy, ExternalLink, KeyRound, Terminal, X } from 'lucide-react';
import {
  buildProjectAIPromptById,
  getAIPromptDefinition,
  getAIPromptIdsForProject,
} from '~/shared/constants/aiPrompts';
import { Project } from '~/shared/types';
import { dashboardButtonClass, dashboardCardClass, dashboardChipClass, dashboardLabelClass } from './dashboardStyles';
import { Modal } from './Modal';

interface ProjectCreatedModalProps {
  isOpen: boolean;
  onClose: () => void;
  project: Project | null;
}

function getProjectPlatformLabel(project: Project): string {
  if (project.platforms.length === 0) return 'No platform selected';
  const platforms = new Set(project.platforms);
  const labels: string[] = [];
  if (platforms.has('web')) labels.push('Web');
  if (platforms.has('unity')) {
    labels.push('Unity');
  } else if (platforms.has('react-native')) {
    labels.push('React Native');
  } else if (platforms.has('flutter')) {
    labels.push('Flutter');
  } else if (platforms.has('ios')) {
    labels.push('iOS');
  }
  if (platforms.has('android') && !platforms.has('react-native') && !platforms.has('flutter') && !platforms.has('unity')) {
    labels.push('Native Android (unsupported)');
  }
  if (labels.length === 1) return `${labels[0]} app`;
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;

  return `${labels.slice(0, -1).join(', ')}, and ${labels[labels.length - 1]}`;
}

export const ProjectCreatedModal: React.FC<ProjectCreatedModalProps> = ({
  isOpen,
  onClose,
  project,
}) => {
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedPrompt, setCopiedPrompt] = useState(false);

  const setupInstructionPrompts = useMemo(() => {
    return getAIPromptIdsForProject(project).map((promptId) => {
      const definition = getAIPromptDefinition(promptId);
      return {
        id: promptId,
        label: definition.label,
        promptText: buildProjectAIPromptById(promptId, project),
      };
    });
  }, [project]);

  const promptText = useMemo(() => {
    if (setupInstructionPrompts.length === 1) return setupInstructionPrompts[0].promptText;

    return [
      'Use the matching Rejourney AI setup instructions for this project.',
      'Choose the section that matches the app you are editing and follow it exactly.',
      '',
      ...setupInstructionPrompts.flatMap((prompt) => [
        '==========================================================',
        `AI SETUP INSTRUCTIONS: ${prompt.label}`,
        '==========================================================',
        '',
        prompt.promptText,
        '',
      ]),
    ].join('\n').trim();
  }, [setupInstructionPrompts]);

  const handleCopyPublicKey = useCallback(async () => {
    if (!project?.publicKey) return;

    await navigator.clipboard.writeText(project.publicKey);
    setCopiedKey(true);
    window.setTimeout(() => setCopiedKey(false), 2000);
  }, [project?.publicKey]);

  const handleCopyPrompt = useCallback(async () => {
    await navigator.clipboard.writeText(promptText);
    setCopiedPrompt(true);
    window.setTimeout(() => setCopiedPrompt(false), 2000);
  }, [promptText]);

  const handleOpenDocs = useCallback(() => {
    window.open('/docs', '_blank');
  }, []);

  if (!project) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title=""
      size="lg"
      showCloseButton={false}
      panelClassName="max-w-4xl"
      variant="modern"
      bodyClassName="p-0"
    >
      <div className="bg-white">
        <div className="border-b border-[#e8eaed] bg-[#f8fafd] px-5 py-6 sm:px-8 sm:py-7">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-none bg-[#e6f4ea] text-[#137333]">
                <CheckCircle2 className="h-6 w-6" />
              </div>
              <div>
                <div className={`${dashboardChipClass('success')} mb-2`}>
                  Project ready
                </div>
                <h2 className="text-xl font-medium text-[#202124]">
                  {project.name} is set up and ready for integration.
                </h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-[#3c4043]">
                  Copy the public key or AI setup instructions for this project.
                </p>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <span className={dashboardChipClass('info')}>
                    {getProjectPlatformLabel(project)}
                  </span>
                  {project.bundleId && (
                    <span className="rounded-none border border-[#dadce0] bg-white px-2 py-0.5 font-mono text-[11px] text-[#3c4043]">
                      iOS: {project.bundleId}
                    </span>
                  )}
                  {project.packageName && (
                    <span className="rounded-none border border-[#dadce0] bg-white px-2 py-0.5 font-mono text-[11px] text-[#3c4043]">
                      Android: {project.packageName}
                    </span>
                  )}
                  {(project.webAllowedDomains?.length || project.webDomain) && (
                    <span className="rounded-none border border-[#dadce0] bg-white px-2 py-0.5 font-mono text-[11px] text-[#3c4043]">
                      Web: {(project.webAllowedDomains?.[0] || project.webDomain)}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="rounded-none p-1.5 text-[#5f6368] transition-colors hover:bg-[#f1f3f4] hover:text-[#202124] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1a73e8]/40"
            >
              <X className="h-5 w-5" />
              <span className="sr-only">Close</span>
            </button>
          </div>
        </div>

        <div className="space-y-5 px-5 py-6 sm:px-8 sm:py-7">
          <div className="grid gap-4 lg:grid-cols-[1.1fr,0.9fr]">
            <section className={`${dashboardCardClass} p-5`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-base font-medium text-[#202124]">
                    <KeyRound className="h-4 w-4 text-[#5f6368]" />
                    Public key
                  </div>
                  <p className="mt-1 text-sm text-[#3c4043]">
                    Use this to initialize the SDK. It is safe to ship in the client app.
                  </p>
                </div>
              </div>

              <div className="mt-4 break-all rounded-none border border-[#dadce0] bg-[#f8fafd] px-4 py-3 font-mono text-[13px] leading-6 text-[#202124]">
                {project.publicKey}
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleCopyPublicKey}
                  className={dashboardButtonClass('secondary', 'md')}
                >
                  {copiedKey ? <CheckCircle2 className="h-4 w-4 text-[#137333]" /> : <Copy className="h-4 w-4" />}
                  {copiedKey ? 'Public key copied' : 'Copy public key'}
                </button>
              </div>
            </section>

            <section className={`${dashboardCardClass} p-5`}>
              <div className="flex items-center gap-2 text-base font-medium text-[#202124]">
                <Terminal className="h-4 w-4 text-[#5f6368]" />
                AI setup instructions
              </div>
              <p className="mt-2 text-sm leading-6 text-[#3c4043]">
                Copy setup instructions tailored to this project and paste them into your AI coding assistant.
              </p>

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleCopyPrompt}
                  className={dashboardButtonClass('primary', 'md')}
                >
                  {copiedPrompt ? <CheckCircle2 className="h-4 w-4" /> : <Terminal className="h-4 w-4" />}
                  {copiedPrompt ? 'Setup instructions copied' : 'Copy AI setup instructions'}
                </button>
                <button
                  type="button"
                  onClick={handleOpenDocs}
                  className={dashboardButtonClass('secondary', 'md')}
                >
                  <ExternalLink className="h-4 w-4" />
                  Open docs
                </button>
              </div>
            </section>
          </div>

          <section className={`${dashboardCardClass} px-5 py-4`}>
            <h3 className="text-base font-medium text-[#202124]">Recommended next steps</h3>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <div className="rounded-none border border-[#e8eaed] bg-[#f8fafd] p-4">
                <div className={dashboardLabelClass}>Step 1</div>
                <p className="mt-2 text-sm text-[#3c4043]">Pick your stack: Web, React Native, Flutter, Unity, or native Swift.</p>
              </div>
              <div className="rounded-none border border-[#e8eaed] bg-[#f8fafd] p-4">
                <div className={dashboardLabelClass}>Step 2</div>
                <p className="mt-2 text-sm text-[#3c4043]">Initialize the SDK with this project’s public key.</p>
              </div>
              <div className="rounded-none border border-[#e8eaed] bg-[#f8fafd] p-4">
                <div className={dashboardLabelClass}>Step 3</div>
                <p className="mt-2 text-sm text-[#3c4043]">Ship a test build and confirm new sessions start appearing in the dashboard.</p>
              </div>
            </div>
          </section>
        </div>

        <div className="flex flex-col gap-2 border-t border-[#e8eaed] bg-[#f8fafd] px-5 py-4 sm:flex-row sm:justify-end sm:px-8">
          <button
            type="button"
            onClick={onClose}
            className={dashboardButtonClass('secondary', 'md')}
          >
            Close
          </button>
          <button
            type="button"
            onClick={handleOpenDocs}
            className={dashboardButtonClass('primary', 'md')}
          >
            <ExternalLink className="h-4 w-4" />
            View full docs
          </button>
        </div>
      </div>
    </Modal>
  );
};
