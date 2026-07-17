import assert from 'node:assert/strict';
import test from 'node:test';
import type { Project } from '../../../shared/types';
import { useProjectStore } from '../projectStore';

const makeProject = (id: string): Project => ({
  id,
  name: `项目 ${id}`,
  description: '',
  folderPath: `D:\\workspace\\${id}`,
  status: 'active',
  progress: 0,
  createdAt: '2026-07-14T00:00:00.000Z',
  updatedAt: '2026-07-14T00:00:00.000Z',
});

const reset = () => {
  useProjectStore.setState({
    projects: [],
    currentProject: null,
    currentStageName: '',
    pendingReportDocId: null,
    pendingReportDocOnly: false,
    versions: [],
    isLoading: false,
  });
};

test('successful project deletion removes the project only after the requested mode succeeds', async () => {
  reset();
  const project = makeProject('project-1');
  useProjectStore.setState({ projects: [project], currentProject: project });
  let receivedRequest: unknown;
  let resolveDelete: ((result: { success: boolean; recycleEntry: { id: string; name: string } }) => void) | undefined;
  (globalThis as typeof globalThis & { window: any }).window = {
    electronAPI: {
      deleteProject: async (id: string, options: unknown) => {
        receivedRequest = { id, options };
        return new Promise(resolve => {
          resolveDelete = resolve;
        });
      },
    },
  };

  const pendingResult = useProjectStore.getState().deleteProject(project.id, { mode: 'delete-folder' });

  assert.deepEqual(receivedRequest, { id: project.id, options: { mode: 'delete-folder' } });
  assert.deepEqual(useProjectStore.getState().projects, [project]);
  assert.equal(useProjectStore.getState().currentProject?.id, project.id);

  assert.ok(resolveDelete);
  resolveDelete({ success: true, recycleEntry: { id: 'recycle-1', name: project.name } });
  const result = await pendingResult;

  assert.equal(result.recycleEntry?.id, 'recycle-1');
  assert.deepEqual(useProjectStore.getState().projects, []);
  assert.equal(useProjectStore.getState().currentProject, null);
  reset();
});

test('failed project deletion leaves the project list and current selection unchanged', async () => {
  reset();
  const currentProject = makeProject('project-1');
  const otherProject = makeProject('project-2');
  const originalProjects = [currentProject, otherProject];
  useProjectStore.setState({ projects: originalProjects, currentProject });
  (globalThis as typeof globalThis & { window: any }).window = {
    electronAPI: {
      deleteProject: async () => ({ success: false, error: 'filesystem busy' }),
    },
  };

  const previousConsoleError = console.error;
  console.error = () => undefined;
  try {
    await assert.rejects(
      useProjectStore.getState().deleteProject(currentProject.id, { mode: 'delete-folder' }),
      /filesystem busy/,
    );
    assert.deepEqual(useProjectStore.getState().projects, originalProjects);
    assert.deepEqual(useProjectStore.getState().currentProject, currentProject);
  } finally {
    console.error = previousConsoleError;
    reset();
  }
});

test('project selection updates immediately and does not carry a stage across projects', () => {
  reset();
  const firstProject = makeProject('project-1');
  const secondProject = makeProject('project-2');
  useProjectStore.setState({
    projects: [firstProject, secondProject],
    currentProject: firstProject,
    currentStageName: 'implementation',
  });

  useProjectStore.getState().setCurrentProject(secondProject);

  assert.equal(useProjectStore.getState().currentProject?.id, secondProject.id);
  assert.equal(useProjectStore.getState().currentStageName, '');

  useProjectStore.setState({ currentStageName: 'planning' });
  useProjectStore.getState().setCurrentProject({ ...secondProject, description: 'refreshed' });

  assert.equal(useProjectStore.getState().currentProject?.description, 'refreshed');
  assert.equal(useProjectStore.getState().currentStageName, 'planning');
  reset();
});
