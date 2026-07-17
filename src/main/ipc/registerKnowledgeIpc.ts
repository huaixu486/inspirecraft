import { ReferenceMaterial, StageMemoryEntry } from '../types';
import { defineIpcHandler } from './registry';

export const isKnowledgeIpc = (channel: string) => /^knowledge:/.test(channel);

export const defineKnowledgeIpc = (deps: {
  loadStageMemories: () => StageMemoryEntry[];
  saveStageMemories: (entries: StageMemoryEntry[]) => void;
  removeStageMemoriesForDoc: (docId?: string) => number;
  learnStageFinal: (params: any) => Promise<any>;
  loadReferenceMaterials: () => ReferenceMaterial[];
  saveReferenceMaterials: (entries: ReferenceMaterial[]) => void;
  saveReferenceMaterial: (material: ReferenceMaterial) => ReferenceMaterial;
  importReferenceFiles: (params: { projectId: string; filePaths: string[]; source?: 'project-file' | 'external' }) => Promise<any>;
}) => {
  defineIpcHandler('knowledge:loadStageMemories', async () => deps.loadStageMemories());
  defineIpcHandler('knowledge:saveStageMemory', async (_event, entry: StageMemoryEntry) => {
    const entries = deps.loadStageMemories();
    const index = entries.findIndex(item => item.id === entry.id);
    if (index >= 0) entries[index] = entry;
    else entries.push(entry);
    deps.saveStageMemories(entries);
    return entry;
  });
  defineIpcHandler('knowledge:deleteStageMemory', async (_event, memoryId: string) => deps.saveStageMemories(deps.loadStageMemories().filter(item => item.id !== memoryId)));
  defineIpcHandler('knowledge:deleteStageMemoriesForDoc', async (_event, docId: string) => ({ success: true, removed: deps.removeStageMemoriesForDoc(docId) }));
  defineIpcHandler('knowledge:learnStageFinal', async (_event, params) => deps.learnStageFinal(params));
  defineIpcHandler('knowledge:loadReferenceMaterials', async () => deps.loadReferenceMaterials());
  defineIpcHandler('knowledge:saveReferenceMaterial', async (_event, material: ReferenceMaterial) => deps.saveReferenceMaterial(material));
  defineIpcHandler('knowledge:deleteReferenceMaterial', async (_event, materialId: string) => deps.saveReferenceMaterials(deps.loadReferenceMaterials().filter(item => item.id !== materialId)));
  defineIpcHandler('knowledge:importReferenceFiles', async (_event, params) => deps.importReferenceFiles(params));
};
