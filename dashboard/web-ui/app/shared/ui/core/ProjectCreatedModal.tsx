/**
 * Project Created Success Modal
 *
 * Shows after successful project creation with project key and AI prompt copy actions.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { CheckCircle2, Copy, ExternalLink, KeyRound, Sparkles, X } from 'lucide-react';
import { AI_INTEGRATION_PROMPT } from '~/shared/constants/aiPrompts';
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
  if (project.platforms.length === 2) return 'iOS and Android';

  return project.platforms[0] === 'ios' ? 'iOS app' : 'Android app';
}

export const ProjectCreatedModal: React.FC<ProjectCreatedModalProps> = ({
  isOpen,
  onClose,
  project,
}) => {
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedPrompt, setCopiedPrompt] = useState(false);

  const promptText = useMemo(() => {
    if (!project?.publicKey) return AI_INTEGRATION_PROMPT;
    return AI_INTEGRATION_PROMPT.replace('PUBLIC_KEY_HERE', project.publicKey);
  }, [project?.publicKey]);

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
      panelClassName="max-w-3xl rounded-3xl border border-slate-200 shadow-[0_32px_80px_-32px_rgba(15,23,42,0.5)]"
      bodyClassName="p-0"
    >
      <div className="overflow-hidden rounded-3xl bg-white">
        <div className="border-b border-slate-200 bg-[linear-gradient(135deg,rgba(248,250,252,1),rgba(240,249,255,1))] px-8 py-7">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-emerald-200 bg-emerald-50 text-emerald-600">
                <CheckCircle2 className="h-6 w-6" />
              </div>
              <div>
                <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-700">
                  Project Ready
                </div>
                <h2 className="text-2xl font-semibold tracking-tight text-slate-900">
                  {project.name} is set up and ready for integration.
                </h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                  Copy the public key or grab a ready-to-paste AI setup prompt with this project already filled in.
                </p>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600">
                    {getProjectPlatformLabel(project)}
                  </span>
                  {project.bundleId && (
                    <span className="rounded-full border border-slate-200 bg-white px-3 py-1 font-mono text-[11px] text-slate-500">
                      iOS: {project.bundleId}
                    </span>
                  )}
                  {project.packageName && (
                    <span className="rounded-full border border-slate-200 bg-white px-3 py-1 font-mono text-[11px] text-slate-500">
                      Android: {project.packageName}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-transparent p-2 text-slate-400 transition-colors hover:border-slate-200 hover:bg-white hover:text-slate-700"
            >
              <X className="h-5 w-5" />
              <span className="sr-only">Close</span>
            </button>
          </div>
        </div>

        <div className="space-y-6 px-8 py-7">
          <div className="grid gap-4 lg:grid-cols-[1.1fr,0.9fr]">
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <KeyRound className="h-4 w-4 text-slate-500" />
                    Public key
                  </div>
                  <p className="mt-1 text-sm text-slate-600">
                    Use this in `Rejourney.init(...)`. It is safe to ship in the client app.
                  </p>
                </div>
              </div>

              <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 font-mono text-[13px] leading-6 text-slate-700 break-all">
                {project.publicKey}
              </div>

              <div className="mt-4 flex flex-wrap gap-3">
                <Button
                  variant="outline"
                  onClick={handleCopyPublicKey}
                  className="border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                >
                  {copiedKey ? <CheckCircle2 className="mr-2 h-4 w-4 text-emerald-600" /> : <Copy className="mr-2 h-4 w-4" />}
                  {copiedKey ? 'Public key copied' : 'Copy public key'}
                </Button>
              </div>
            </section>

            <section className="rounded-2xl border border-violet-200 bg-violet-50/60 p-5 shadow-sm">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Sparkles className="h-4 w-4 text-violet-600" />
                AI setup prompt
              </div>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                This copies the React Native integration prompt with your new project key already inserted for ChatGPT, Claude, Cursor, or any other coding assistant.
              </p>

              <div className="mt-4 rounded-2xl border border-violet-200 bg-white/80 px-4 py-3 text-xs leading-6 text-slate-500">
                Includes install steps, init example, navigation tracking, privacy notes, and your project key.
              </div>

              <div className="mt-4 flex flex-wrap gap-3">
                <Button
                  variant="primary"
                  onClick={handleCopyPrompt}
                  className="bg-slate-900 text-white hover:bg-slate-800"
                >
                  {copiedPrompt ? <CheckCircle2 className="mr-2 h-4 w-4" /> : <Sparkles className="mr-2 h-4 w-4" />}
                  {copiedPrompt ? 'Prompt copied' : 'Copy AI prompt'}
                </Button>
                <Button
                  variant="outline"
                  onClick={handleOpenDocs}
                  className="border-violet-200 bg-white text-violet-700 hover:bg-violet-100"
                >
                  <ExternalLink className="mr-2 h-4 w-4" />
                  Open docs
                </Button>
              </div>
            </section>
          </div>

          <section className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4">
            <h3 className="text-sm font-semibold text-slate-900">Recommended next steps</h3>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">Step 1</div>
                <p className="mt-2 text-sm text-slate-700">Install `@rejourneyco/react-native` in your app.</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">Step 2</div>
                <p className="mt-2 text-sm text-slate-700">Initialize the SDK with this project’s public key.</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">Step 3</div>
                <p className="mt-2 text-sm text-slate-700">Ship a test build and confirm new sessions start appearing in the dashboard.</p>
              </div>
            </div>
          </section>
        </div>

        <div className="flex flex-col gap-3 border-t border-slate-200 bg-white px-8 py-5 sm:flex-row sm:justify-end">
          <Button
            variant="secondary"
            onClick={onClose}
            className="bg-slate-100 text-slate-700 hover:bg-slate-200"
          >
            Close
          </Button>
          <Button
            variant="primary"
            onClick={handleOpenDocs}
            className="bg-slate-900 text-white hover:bg-slate-800"
          >
            <ExternalLink className="mr-2 h-4 w-4" />
            View full docs
          </Button>
        </div>
      </div>
    </Modal>
  );
};
