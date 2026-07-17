import { ProjectDocument } from '../types';
import { defineIpcHandler } from './registry';

export const isDocumentIpc = (channel: string) => /^(projectDoc|review):/.test(channel);

export const defineReviewIpc = (deps: {
  execute: (params: any) => Promise<unknown>;
  loadAll: () => Promise<unknown>;
  delete: (reviewId: string) => Promise<unknown>;
}) => {
  defineIpcHandler('review:execute', async (_event, params: any) => deps.execute(params));
  defineIpcHandler('review:loadAll', async () => deps.loadAll());
  defineIpcHandler('review:delete', async (_event, reviewId: string) => deps.delete(reviewId));
};

export const defineProjectDocumentIpc = (deps: {
  load: () => ProjectDocument[];
  save: (docs: ProjectDocument[]) => void;
  onDelete: (docId: string) => void;
  analyze: (params: any) => Promise<any>;
}) => {
  defineIpcHandler('projectDoc:save', async (_event, doc: ProjectDocument) => {
    const docs = deps.load();
    const index = docs.findIndex(item => item.id === doc.id);
    if (index >= 0) docs[index] = doc;
    else docs.push(doc);
    deps.save(docs);
  });
  defineIpcHandler('projectDoc:loadAll', async () => deps.load());
  defineIpcHandler('projectDoc:delete', async (_event, docId: string) => {
    deps.save(deps.load().filter(item => item.id !== docId));
    deps.onDelete(docId);
  });
  defineIpcHandler('projectDoc:analyze', async (_event, params) => deps.analyze(params));
};

export const defineDocumentFileIpc = (deps: {
  replaceText: (params: { filePath: string; originalText: string; replacementText: string }) => Promise<unknown>;
  parseWord: (filePath: string) => Promise<unknown>;
  applyParagraphFormats: (params: { sourcePath: string; targetPath: string; paragraphIndices: number[] }) => Promise<unknown>;
  extractTemplateFormatRules: (filePath: string) => Promise<unknown>;
  parseDocument: (filePath: string) => Promise<unknown>;
  parseDocumentSilent: (filePath: string) => Promise<unknown>;
  parsePdf: (filePath: string) => Promise<unknown>;
}) => {
  defineIpcHandler('file:replaceDocumentText', async (_event, params: { filePath: string; originalText: string; replacementText: string }) => deps.replaceText(params));
  defineIpcHandler('file:parseWord', async (_event, filePath: string) => deps.parseWord(filePath));
  defineIpcHandler('file:applyDocumentParagraphFormats', async (_event, params: { sourcePath: string; targetPath: string; paragraphIndices: number[] }) => deps.applyParagraphFormats(params));
  defineIpcHandler('file:extractTemplateFormatRules', async (_event, filePath: string) => deps.extractTemplateFormatRules(filePath));
  defineIpcHandler('file:parseDocument', async (_event, filePath: string) => deps.parseDocument(filePath));
  defineIpcHandler('file:parseDocumentSilent', async (_event, filePath: string) => deps.parseDocumentSilent(filePath));
  defineIpcHandler('file:parsePdf', async (_event, filePath: string) => deps.parsePdf(filePath));
};
