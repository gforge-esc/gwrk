// src/server/sandbox.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
// @ts-ignore - Module does not exist yet (RED)
import { createSandbox, destroySandbox, listSandboxes, destroyAllSandboxes } from './sandbox';
// @ts-ignore - Types do not exist yet (RED)
import { SandboxOptions } from './sandbox';
import Docker from 'dockerode';

vi.mock('dockerode');

describe('T014: Implement Docker sandbox manager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createSandbox', () => {
    it('creates and starts a Docker container with correct labels and mounts (US-004)', async () => {
      const opts: any = {
        featureId: '002-build-server',
        phaseId: 'phase-04',
        branchName: 'phase/002-build-server-phase-04',
        repoPath: '/tmp/gwrk-repo',
        backend: 'gemini',
        contextPath: '/tmp/gwrk-context.md'
      };

      const mockContainer = {
        start: vi.fn().mockResolvedValue({}),
        id: 'mock-container-id'
      };

      const mockDocker = {
        createContainer: vi.fn().mockResolvedValue(mockContainer),
        getImage: vi.fn().mockReturnValue({
          inspect: vi.fn().mockResolvedValue({ id: 'mock-image-id' })
        })
      };

      (Docker as any).mockImplementation(() => mockDocker);

      const result = await createSandbox(opts);

      expect(mockDocker.createContainer).toHaveBeenCalledWith(expect.objectContaining({
        Image: 'gwrk-sandbox:bookworm-slim',
        Labels: {
          'gwrk.feature': '002-build-server',
          'gwrk.phase': 'phase-04',
          'gwrk.backend': 'gemini'
        },
        HostConfig: expect.objectContaining({
          Binds: expect.arrayContaining([
            '/tmp/gwrk-repo:/workspace:rw'
          ])
        })
      }));
      expect(mockContainer.start).toHaveBeenCalled();
      expect(result).toMatchObject({
        containerId: 'mock-container-id',
        status: 'running',
        featureId: '002-build-server',
        phaseId: 'phase-04',
        backend: 'gemini'
      });
      expect(result.startedAt).toBeDefined();
    });

    it('rejects if Docker daemon is not reachable (FR-005 error state)', async () => {
      const mockDocker = {
        getImage: vi.fn().mockImplementation(() => {
          throw new Error('Docker daemon not reachable');
        })
      };
      (Docker as any).mockImplementation(() => mockDocker);

      await expect(createSandbox({} as any)).rejects.toThrow('Docker daemon not reachable');
    });

    it('rejects if gwrk-sandbox image is not found (US-008)', async () => {
      const mockDocker = {
        getImage: vi.fn().mockReturnValue({
          inspect: vi.fn().mockRejectedValue(new Error('no such image'))
        })
      };
      (Docker as any).mockImplementation(() => mockDocker);

      await expect(createSandbox({} as any)).rejects.toThrow(/image gwrk-sandbox:bookworm-slim not found/i);
    });
  });

  describe('destroySandbox', () => {
    it('stops and removes the container (US-002)', async () => {
      const mockContainer = {
        stop: vi.fn().mockResolvedValue({}),
        remove: vi.fn().mockResolvedValue({})
      };

      const mockDocker = {
        getContainer: vi.fn().mockReturnValue(mockContainer)
      };

      (Docker as any).mockImplementation(() => mockDocker);

      await destroySandbox('mock-id');

      expect(mockDocker.getContainer).toHaveBeenCalledWith('mock-id');
      expect(mockContainer.stop).toHaveBeenCalled();
      expect(mockContainer.remove).toHaveBeenCalled();
    });

    it('gracefully handles containers that are already stopped', async () => {
      const mockContainer = {
        stop: vi.fn().mockRejectedValue({ statusCode: 304 }), // Docker 304 means already stopped
        remove: vi.fn().mockResolvedValue({})
      };

      const mockDocker = {
        getContainer: vi.fn().mockReturnValue(mockContainer)
      };

      (Docker as any).mockImplementation(() => mockDocker);

      await destroySandbox('mock-id');

      expect(mockContainer.remove).toHaveBeenCalled();
    });
  });

  describe('listSandboxes', () => {
    it('returns a list of gwrk-labeled containers (US-004)', async () => {
      const mockContainers = [
        {
          Id: 'id-1',
          Labels: { 'gwrk.feature': 'f1', 'gwrk.phase': 'p1', 'gwrk.backend': 'gemini' },
          State: 'running',
          Created: 123456789
        }
      ];

      const mockDocker = {
        listContainers: vi.fn().mockResolvedValue(mockContainers)
      };

      (Docker as any).mockImplementation(() => mockDocker);

      const results = await listSandboxes();

      expect(mockDocker.listContainers).toHaveBeenCalledWith({
        filters: JSON.stringify({ label: ['gwrk.feature'] })
      });
      expect(results).toHaveLength(1);
      expect(results[0].containerId).toBe('id-1');
    });
  });

  describe('destroyAllSandboxes', () => {
    it('destroys all containers with gwrk labels (US-002)', async () => {
      const mockContainers = [
        { Id: 'id-1' },
        { Id: 'id-2' }
      ];

      const mockContainer = {
        stop: vi.fn().mockResolvedValue({}),
        remove: vi.fn().mockResolvedValue({})
      };

      const mockDocker = {
        listContainers: vi.fn().mockResolvedValue(mockContainers),
        getContainer: vi.fn().mockReturnValue(mockContainer)
      };

      (Docker as any).mockImplementation(() => mockDocker);

      const count = await destroyAllSandboxes();

      expect(count).toBe(2);
      expect(mockContainer.stop).toHaveBeenCalledTimes(2);
      expect(mockContainer.remove).toHaveBeenCalledTimes(2);
    });
  });
});
