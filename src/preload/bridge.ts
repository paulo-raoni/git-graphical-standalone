import { contextBridge, ipcRenderer } from 'electron';

import { BRIDGE_GLOBAL_NAME, CHANNELS } from '../contracts/index';
import type {
  ApplicationInfoResponse,
  ChannelName,
  ChooseFolderResponse,
  GitGraphicalBridge,
  LoadMoreCommitsRequest,
  LoadMoreCommitsResponse,
  OpenRepositoryRequest,
  OpenRepositoryResponse,
  RefreshRequest,
  RefreshResponse,
} from '../contracts/index';

/**
 * Send one request over one channel.
 *
 * Deliberately not exported and deliberately not exposed: the renderer gets the
 * methods below and never this function, so it cannot name a channel of its
 * own. Every channel the page can reach is spelled out in `bridge`, which is the
 * allow-list.
 */
async function request<TResponse>(channel: ChannelName, payload?: unknown): Promise<TResponse> {
  const response: unknown = await ipcRenderer.invoke(channel, payload);
  return response as TResponse;
}

const bridge: GitGraphicalBridge = {
  openRepository: (openRequest: OpenRepositoryRequest): Promise<OpenRepositoryResponse> =>
    request<OpenRepositoryResponse>(CHANNELS.openRepository, openRequest),
  chooseFolder: (): Promise<ChooseFolderResponse> =>
    request<ChooseFolderResponse>(CHANNELS.chooseFolder),
  loadMoreCommits: (loadRequest: LoadMoreCommitsRequest): Promise<LoadMoreCommitsResponse> =>
    request<LoadMoreCommitsResponse>(CHANNELS.loadMoreCommits, loadRequest),
  refresh: (refreshRequest: RefreshRequest): Promise<RefreshResponse> =>
    request<RefreshResponse>(CHANNELS.refresh, refreshRequest),
  applicationInfo: (): Promise<ApplicationInfoResponse> =>
    request<ApplicationInfoResponse>(CHANNELS.applicationInfo),
};

contextBridge.exposeInMainWorld(BRIDGE_GLOBAL_NAME, bridge);
