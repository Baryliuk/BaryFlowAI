import { Draft, AlbumCache } from "../types";

export const albumCache = new Map<string, AlbumCache>();
export const draftStore = new Map<string, Draft>();
export const editingSession = new Map<number, string>();