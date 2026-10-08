import type { Issue, Publication } from './types';

export interface PublisherSettings {
  configured: boolean;
  roots: string[];
  defaultAccount: string;
  port: number;
}
export const DEFAULT_SETTINGS: PublisherSettings = {
  configured: false,
  roots: ['02-项目/内容IP变现/03-平台与发布/发布'],
  defaultAccount: '', port: 27123
};
export interface Preview {
  publication: Publication;
  text: string;
  fingerprint: string;
  issues: Issue[];
}
export interface RunRecord {
  id: string;
  path: string;
  title: string;
  account: string;
  imageCount: number;
  fingerprint: string;
  createdAt: number;
  updatedAt: number;
  status: '已准备' | '正在填写' | '待人工确认' | '失败' | '结果待核实' | '已取消' | '需重新准备';
  detail: string;
  closed?: boolean;
}
export interface PublisherHost {
  settings: PublisherSettings;
  demo?: boolean;
  list(): Promise<Publication[]>;
  save(publication: Publication): Promise<Publication>;
  create(title: string): Promise<Publication>;
  inspect(path: string): Promise<Preview>;
  prepare(approved: Array<{path: string; fingerprint: string}>): Promise<void>;
  records(): RunRecord[];
  cancel(id: string): Promise<void>;
  acknowledge(id: string): void;
  mediaUrl(path: string): string;
  searchImages(query: string): string[];
  openNote(path: string): void;
  saveSettings(settings: PublisherSettings): Promise<void>;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  connection(): {running: boolean; port: number; paired: boolean; token: string};
  subscribe(listener: () => void): () => void;
  notify(message: string): void;
}
