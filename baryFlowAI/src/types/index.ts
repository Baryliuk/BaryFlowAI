export interface Draft {
  photos: string[];
  fileIds: string[];
  caption: string;
}

export interface AlbumCache {
  photos: string[];
  fileIds: string[];
  caption?: string;
  timer?: NodeJS.Timeout;
}

export enum BotAction {
  PUBLISH = "pub",
  DELETE = "del",
}