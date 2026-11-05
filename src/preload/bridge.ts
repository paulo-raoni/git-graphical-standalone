import { contextBridge, ipcRenderer } from 'electron';

import { BRIDGE_GLOBAL_NAME, CHANNELS } from '../contracts/index';
import type {
  ApplicationInfoResponse,
  ChannelName,
  ChooseFolderResponse,
  ChooseThemeRequest,
  ChooseThemeResponse,
  DetailsRequest,
  DetailsResponse,
  GitGraphicalBridge,
  LoadMoreCommitsRequest,
  LoadMoreCommitsResponse,
  OpenRepositoryRequest,
  OpenRepositoryResponse,
  RefreshRequest,
  RefreshResponse,
  StartupRepositoryResponse,
  ThemeChoiceResponse,
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
  startupRepository: (): Promise<StartupRepositoryResponse> =>
    request<StartupRepositoryResponse>(CHANNELS.startupRepository),
  openRepository: (openRequest: OpenRepositoryRequest): Promise<OpenRepositoryResponse> =>
    request<OpenRepositoryResponse>(CHANNELS.openRepository, openRequest),
  chooseFolder: (): Promise<ChooseFolderResponse> =>
    request<ChooseFolderResponse>(CHANNELS.chooseFolder),
  loadMoreCommits: (loadRequest: LoadMoreCommitsRequest): Promise<LoadMoreCommitsResponse> =>
    request<LoadMoreCommitsResponse>(CHANNELS.loadMoreCommits, loadRequest),
  refresh: (refreshRequest: RefreshRequest): Promise<RefreshResponse> =>
    request<RefreshResponse>(CHANNELS.refresh, refreshRequest),
  commitDetails: (detailsRequest: DetailsRequest): Promise<DetailsResponse> =>
    request<DetailsResponse>(CHANNELS.commitDetails, detailsRequest),
  applicationInfo: (): Promise<ApplicationInfoResponse> =>
    request<ApplicationInfoResponse>(CHANNELS.applicationInfo),
  themeChoice: (): Promise<ThemeChoiceResponse> =>
    request<ThemeChoiceResponse>(CHANNELS.themeChoice),
  chooseTheme: (themeRequest: ChooseThemeRequest): Promise<ChooseThemeResponse> =>
    request<ChooseThemeResponse>(CHANNELS.chooseTheme, themeRequest),
};

contextBridge.exposeInMainWorld(BRIDGE_GLOBAL_NAME, bridge);
