export interface FileTransferMeta {
  type: 'START';
  name: string;
  size: number;
  mime: string;
}

export interface ChunkPayload {
  type: 'CHUNK';
  chunk: ArrayBuffer;
}

export interface TransferEndMeta {
  type: 'END';
}

export type SocketMessage = FileTransferMeta | ChunkPayload | TransferEndMeta;
