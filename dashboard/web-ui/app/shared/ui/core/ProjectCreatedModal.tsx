/**
 * Project Created Success Modal
 *
 * Shows after successful project creation with project key and AI prompt copy actions.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { CheckCircle2, Copy, ExternalLink, KeyRound, Sparkles, X } from 'lucide-react';
import {
  buildProjectAIPromptById,
  getAIPromptDefinition,
  getAIPromptIdsForProject,
} from '~/shared/constants/aiPrompts';
import { Project } from '~/shared/types';
import { Button } from './Button';
import { Modal } from './Modal';

interface ProjectCreatedModalProps {
  isOpen: boolean;
  onClose: () => void;
  project: Project | null;
}

function getProjectPlatformLabel(project: Project): string {
  if (project.platforms.length === 0) return 'No platform selected';
  const labels = project.platforms.map((platform) => (
    platform === 'ios' ? 'iOS' : platform === 'android' ? 'Android' : platform === 'react-native' ? 'React Native' : 'Web'
  ));
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
      panelClassName="max-w-4xl !rounded-xl !border !border-[#dadce0] !shadow-[0_24px_80px_rgba(15,23,42,0.22)]"
      bodyClassName="p-0"
    >
      <div className="overflow-hidden rounded-xl bg-white">
        <div className="border-b border-[#dadce0] bg-[#f8fafd] px-8 py-7">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-[#b7dfc3] bg-[#e6f4ea] text-[#137333]">
                <CheckCircle2 className="h-6 w-6" />
              </div>
              <div>
                <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-[#b7dfc3] bg-[#e6f4ea] px-3 py-1 text-[11px] font-bold uppercase text-[#137333]">
                  Project Ready
                </div>
                <h2 className="text-2xl font-semibold text-[#202124]">
                  {project.name} is set up and ready for integration.
                </h2>
                <p className="mt-2 max-w-2xl text-sm font-medium leading-6 text-[#3c4043]">
                  Copy the public key or AI setup instructions for this project.
                </p>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-[#bfdbfe] bg-[#eff6ff] px-3 py-1 text-[11px] font-bold uppercase text-[#1d4ed8]">
                    {getProjectPlatformLabel(project)}
                  </span>
                  {project.bundleId && (
                    <span className="rounded-full border border-[#dadce0] bg-white px-3 py-1 font-mono text-[11px] text-slate-600">
                      iOS: {project.bundleId}
                    </span>
                  )}
                  {project.packageName && (
                    <span className="rounded-full border border-[#dadce0] bg-white px-3 py-1 font-mono text-[11px] text-slate-600">
                      Android: {project.packageName}
                    </span>
                  )}
                  {(project.webAllowedDomains?.length || project.webDomain) && (
                    <span className="rounded-full border border-[#dadce0] bg-white px-3 py-1 font-mono text-[11px] text-slate-600">
                      Web: {(project.webAllowedDomains?.[0] || project.webDomain)}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-[#dadce0] bg-white p-2 text-[#3c4043] transition-colors hover:bg-[#f1f3f4] hover:text-[#202124]"
            >
              <X className="h-5 w-5" />
              <span className="sr-only">Close</span>
            </button>
          </div>
        </div>

        <div className="space-y-6 px-8 py-7">
          <div className="grid gap-4 lg:grid-cols-[1.1fr,0.9fr]">
            <section className="rounded-lg border border-[#dadce0] bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-sm font-semibold text-[#202124]">
                    <KeyRound className="h-4 w-4 text-[#5f6368]" />
                    Public key
                  </div>
                  <p className="mt-1 text-sm font-medium text-[#3c4043]">
                    Use this in `Rejourney.init(...)`. It is safe to ship in the client app.
                  </p>
                </div>
              </div>

              <div className="mt-4 rounded-md border border-[#dadce0] bg-[#f8fafd] px-4 py-3 font-mono text-[13px] leading-6 text-[#202124] break-all">
                {project.publicKey}
              </div>

              <div className="mt-4 flex flex-wrap gap-3">
                <Button
                  variant="outline"
                  onClick={handleCopyPublicKey}
                  className="!rounded-md !border !border-[#dadce0] !bg-white font-semibold text-[#202124] !shadow-none hover:!border-[#137333] hover:!bg-[#f0fdf4]"
                >
                  {copiedKey ? <CheckCircle2 className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
                  {copiedKey ? 'Public key copied' : 'Copy public key'}
                </Button>
              </div>
            </section>

            <section className="rounded-lg border border-[#dadce0] bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2 text-sm font-semibold text-[#202124]">
                <Sparkles className="h-4 w-4 text-[#5f6368]" />
                AI setup instructions
              </div>
              <p className="mt-2 text-sm font-medium leading-6 text-[#3c4043]">
                Copy setup instructions tailored to this project and paste them into your AI coding assistant.
              </p>

              <div className="mt-4 flex flex-wrap gap-3">
                <Button
                  variant="primary"
                  onClick={handleCopyPrompt}
                  className="!rounded-md !border !border-[#1a73e8] !bg-[#1a73e8] font-semibold text-white !shadow-none hover:!bg-[#1558b0]"
                >
                  {copiedPrompt ? <CheckCircle2 className="mr-2 h-4 w-4" /> : <Sparkles className="mr-2 h-4 w-4" />}
                  {copiedPrompt ? 'Setup instructions copied' : 'Copy AI setup instructions'}
                </Button>
                <Button
                  variant="outline"
                  onClick={handleOpenDocs}
                  className="!rounded-md !border !border-[#dadce0] !bg-white font-semibold text-[#202124] !shadow-none hover:!border-[#1a73e8] hover:!bg-[#eef4ff]"
                >
                  <ExternalLink className="mr-2 h-4 w-4" />
                  Open docs
                </Button>
              </div>
            </section>
          </div>

          <section className="rounded-lg border border-[#dadce0] bg-white px-5 py-4 shadow-sm">
            <h3 className="text-sm font-semibold text-[#202124]">Recommended next steps</h3>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <div className="rounded-md border border-[#dadce0] bg-[#f8fafd] p-4">
                <div className="text-[11px] font-bold uppercase text-[#5f6368]">Step 1</div>
                <p className="mt-2 text-sm font-medium text-[#202124]">Pick your stack: Web SDK, React Native SDK, or native Swift package.</p>
              </div>
              <div className="rounded-md border border-[#dadce0] bg-[#f8fafd] p-4">
                <div className="text-[11px] font-bold uppercase text-[#5f6368]">Step 2</div>
                <p className="mt-2 text-sm font-medium text-[#202124]">Initialize the SDK with this project’s public key.</p>
              </div>
              <div className="rounded-md border border-[#dadce0] bg-[#f8fafd] p-4">
                <div className="text-[11px] font-bold uppercase text-[#5f6368]">Step 3</div>
                <p className="mt-2 text-sm font-medium text-[#202124]">Ship a test build and confirm new sessions start appearing in the dashboard.</p>
              </div>
            </div>
          </section>
        </div>

        <div className="flex flex-col gap-3 border-t border-[#dadce0] bg-[#f8fafd] px-8 py-5 sm:flex-row sm:justify-end">
          <Button
            variant="secondary"
            onClick={onClose}
            className="!rounded-md !border !border-[#dadce0] !bg-white font-semibold text-[#202124] !shadow-none hover:!bg-[#f1f3f4]"
          >
            Close
          </Button>
          <Button
            variant="primary"
            onClick={handleOpenDocs}
            className="!rounded-md !border !border-[#1a73e8] !bg-[#1a73e8] font-semibold text-white !shadow-none hover:!bg-[#1558b0]"
          >
            <ExternalLink className="mr-2 h-4 w-4" />
            View full docs
          </Button>
        </div>
      </div>
    </Modal>
  );
};
