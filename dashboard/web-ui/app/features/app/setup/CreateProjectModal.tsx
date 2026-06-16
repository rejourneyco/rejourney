import React from 'react';
import type { ApiTeam } from '~/shared/api/client';
import type { Project } from '~/shared/types';
import { Modal } from '~/shared/ui/core/Modal';
import { CreateProjectForm } from './CreateProjectForm';

interface CreateProjectModalProps {
  isOpen: boolean;
  currentTeam?: ApiTeam | null;
  onClose: () => void;
  onCreated: (project: Project) => void | Promise<void>;
}

export const CreateProjectModal: React.FC<CreateProjectModalProps> = ({
  isOpen,
  currentTeam,
  onClose,
  onCreated,
}) => (
  <Modal
    isOpen={isOpen}
    onClose={onClose}
    title="Create Project"
    size="lg"
    variant="modern"
    bodyClassName="p-6"
  >
    <CreateProjectForm
      currentTeam={currentTeam}
      onCancel={onClose}
      onCreated={async (project) => {
        await onCreated(project);
        onClose();
      }}
    />
  </Modal>
);
