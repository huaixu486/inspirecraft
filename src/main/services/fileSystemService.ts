import * as fs from 'fs';
import * as path from 'path';
import type { WritingTemplate } from '../types';
import type { RecycleBinEntry, RecycleBinService } from './recycleBinService';

type CheckResult = { ok: true } | { ok: false; error: string };

export interface FileSystemPathGuards {
  checkWithinWorkspace: (targetPath: string) => CheckResult;
  checkParentWithinWorkspace: (targetPath: string) => CheckResult;
  checkSafeChildName: (name: string) => CheckResult;
}

export interface FileCreationDeps {
  createByType: (filePath: string, fileType: string, template?: WritingTemplate) => Promise<void>;
  writeDocxWithContent: (filePath: string, template: WritingTemplate, sectionContents: Record<string, string>) => Promise<void>;
  createFolderShortcut: (shortcutPath: string, targetPath: string) => void;
}

function isLockedFileError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === 'EBUSY' || code === 'EPERM' || code === 'EACCES';
}

function createAvailableSiblingPath(folderPath: string, fileName: string, extension: string): string {
  let index = 1;
  let candidate = path.join(folderPath, `${fileName} (${index}).${extension}`);
  while (fs.existsSync(candidate)) {
    index += 1;
    candidate = path.join(folderPath, `${fileName} (${index}).${extension}`);
  }
  return candidate;
}

export function createFileSystemService(
  recycleBinService: Pick<RecycleBinService, 'moveToRecycleBin'>,
  guards: FileSystemPathGuards,
  creation: FileCreationDeps,
) {
  const { checkParentWithinWorkspace, checkSafeChildName, checkWithinWorkspace } = guards;
  return {
    rename(params: { filePath: string; newName: string }) {
      const { filePath, newName } = params;
      const pathCheck = checkWithinWorkspace(filePath);
      if (!pathCheck.ok) throw new Error(pathCheck.error);
      const nameCheck = checkSafeChildName(newName);
      if (!nameCheck.ok) throw new Error(nameCheck.error);
      if (!fs.existsSync(filePath)) throw new Error('文件不存在');
      const safeName = path.basename(newName.trim());
      const destPath = path.join(path.dirname(filePath), safeName);
      if (destPath === filePath) return filePath;
      if (fs.existsSync(destPath)) throw new Error('同名文件已存在');
      fs.renameSync(filePath, destPath);
      return destPath;
    },

    importFiles(params: { folderPath: string; filePaths: string[] }) {
      const { folderPath, filePaths } = params;
      const targetCheck = checkParentWithinWorkspace(folderPath);
      if (!targetCheck.ok) throw new Error(targetCheck.error);
      if (!fs.existsSync(folderPath)) fs.mkdirSync(folderPath, { recursive: true });
      if (!fs.statSync(folderPath).isDirectory()) throw new Error('目标位置不是文件夹');

      const targetResolved = path.resolve(folderPath);
      const imported: Array<{ name: string; path: string }> = [];
      for (const sourcePath of filePaths || []) {
        if (!sourcePath || !fs.existsSync(sourcePath)) continue;
        const sourceResolved = path.resolve(sourcePath);
        const stat = fs.statSync(sourceResolved);
        const isDirectory = stat.isDirectory();
        if (!isDirectory && !stat.isFile()) continue;
        if (isDirectory && (targetResolved === sourceResolved || targetResolved.startsWith(sourceResolved + path.sep))) continue;

        const ext = isDirectory ? '' : path.extname(sourceResolved);
        const base = path.basename(sourceResolved, ext);
        let destPath = path.join(folderPath, path.basename(sourceResolved));
        let index = 1;
        while (fs.existsSync(destPath) && path.resolve(destPath) !== sourceResolved) {
          destPath = path.join(folderPath, `${base} (${index})${ext}`);
          index += 1;
        }
        if (path.resolve(destPath) === sourceResolved) continue;
        if (isDirectory) fs.cpSync(sourceResolved, destPath, { recursive: true, errorOnExist: true });
        else fs.copyFileSync(sourceResolved, destPath, fs.constants.COPYFILE_EXCL);
        imported.push({ name: path.basename(destPath), path: destPath });
      }
      return imported;
    },

    importFolder(params: { sourcePath: string; targetFolder: string; mode: 'shortcut' | 'move' }) {
      const sourcePath = path.resolve(String(params.sourcePath || '').trim());
      const targetFolder = path.resolve(String(params.targetFolder || '').trim());
      const targetCheck = checkParentWithinWorkspace(targetFolder);
      if (!targetCheck.ok) throw new Error(targetCheck.error);
      if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isDirectory()) throw new Error('源文件夹不存在或无法访问');
      if (!fs.existsSync(targetFolder)) fs.mkdirSync(targetFolder, { recursive: true });
      if (!fs.statSync(targetFolder).isDirectory()) throw new Error('目标位置不是文件夹');
      if (sourcePath === targetFolder || targetFolder.startsWith(sourcePath + path.sep)) {
        throw new Error('不能将文件夹导入到自身或其子目录');
      }

      const sourceName = path.basename(sourcePath);
      if (params.mode === 'shortcut') {
        let shortcutPath = path.join(targetFolder, `${sourceName} - 快捷方式.lnk`);
        let index = 1;
        while (fs.existsSync(shortcutPath)) {
          shortcutPath = path.join(targetFolder, `${sourceName} - 快捷方式 (${index}).lnk`);
          index += 1;
        }
        creation.createFolderShortcut(shortcutPath, sourcePath);
        return { name: path.basename(shortcutPath), path: shortcutPath, mode: params.mode };
      }

      if (path.dirname(sourcePath) === targetFolder) {
        return { name: sourceName, path: sourcePath, mode: params.mode };
      }

      let destination = path.join(targetFolder, sourceName);
      let index = 1;
      while (fs.existsSync(destination)) {
        destination = path.join(targetFolder, `${sourceName} (${index})`);
        index += 1;
      }
      try {
        fs.renameSync(sourcePath, destination);
      } catch (error: any) {
        if (error?.code !== 'EXDEV') throw error;
        const temporaryDestination = `${destination}.projecthub-importing-${Date.now()}`;
        fs.cpSync(sourcePath, temporaryDestination, { recursive: true, errorOnExist: true });
        try {
          fs.rmSync(sourcePath, { recursive: true, force: false });
          fs.renameSync(temporaryDestination, destination);
        } catch (moveError) {
          fs.rmSync(temporaryDestination, { recursive: true, force: true });
          throw moveError;
        }
      }
      return { name: path.basename(destination), path: destination, mode: params.mode };
    },

    move(params: { sourcePaths: string[]; targetFolder: string }) {
      const { sourcePaths, targetFolder } = params;
      if (!targetFolder) throw new Error('目标文件夹无效');
      for (const sourcePath of sourcePaths || []) {
        const check = checkWithinWorkspace(sourcePath);
        if (!check.ok) throw new Error(check.error);
      }
      const targetCheck = checkWithinWorkspace(targetFolder);
      if (!targetCheck.ok) throw new Error(targetCheck.error);
      if (!fs.existsSync(targetFolder)) fs.mkdirSync(targetFolder, { recursive: true });
      if (!fs.statSync(targetFolder).isDirectory()) throw new Error('目标位置不是文件夹');

      const targetResolved = path.resolve(targetFolder);
      const moved: Array<{ name: string; path: string; sourcePath: string; isDirectory: boolean }> = [];
      const errors: string[] = [];
      for (const sourcePath of sourcePaths || []) {
        if (!sourcePath || !fs.existsSync(sourcePath)) {
          errors.push(`${path.basename(sourcePath || '') || '项目'}不存在`);
          continue;
        }
        const sourceResolved = path.resolve(sourcePath);
        const stat = fs.statSync(sourceResolved);
        const isDirectory = stat.isDirectory();
        if (!isDirectory && !stat.isFile()) continue;
        if (path.dirname(sourceResolved) === targetResolved) continue;
        if (isDirectory && (targetResolved === sourceResolved || targetResolved.startsWith(sourceResolved + path.sep))) {
          errors.push(`不能把“${path.basename(sourcePath)}”移动到自身或其子文件夹中`);
          continue;
        }
        const destPath = path.join(targetFolder, path.basename(sourcePath));
        if (fs.existsSync(destPath)) {
          errors.push(`“${path.basename(sourcePath)}”已存在于目标文件夹`);
          continue;
        }
        try {
          fs.renameSync(sourcePath, destPath);
        } catch (error: any) {
          if (error?.code !== 'EXDEV') throw error;
          if (isDirectory) {
            fs.cpSync(sourcePath, destPath, { recursive: true, errorOnExist: true });
            fs.rmSync(sourcePath, { recursive: true, force: false });
          } else {
            fs.copyFileSync(sourcePath, destPath, fs.constants.COPYFILE_EXCL);
            fs.unlinkSync(sourcePath);
          }
        }
        moved.push({ name: path.basename(destPath), path: destPath, sourcePath, isDirectory });
      }
      return { moved, errors };
    },

    duplicate(params: { sourcePaths: string[]; targetFolder: string }) {
      const { sourcePaths, targetFolder } = params;
      for (const sourcePath of sourcePaths || []) {
        const check = checkWithinWorkspace(sourcePath);
        if (!check.ok) throw new Error(check.error);
      }
      const targetCheck = checkWithinWorkspace(targetFolder);
      if (!targetCheck.ok) throw new Error(targetCheck.error);
      if (!fs.existsSync(targetFolder)) fs.mkdirSync(targetFolder, { recursive: true });
      const copies: Array<{ name: string; path: string; isDirectory: boolean }> = [];
      for (const sourcePath of sourcePaths || []) {
        if (!sourcePath || !fs.existsSync(sourcePath)) continue;
        const stat = fs.statSync(sourcePath);
        const isDirectory = stat.isDirectory();
        if (!isDirectory && !stat.isFile()) continue;
        const ext = isDirectory ? '' : path.extname(sourcePath);
        const base = path.basename(sourcePath, ext);
        let suffix = ' - 副本';
        let destPath = path.join(targetFolder, `${base}${suffix}${ext}`);
        let index = 2;
        while (fs.existsSync(destPath)) {
          suffix = ` - 副本 (${index})`;
          destPath = path.join(targetFolder, `${base}${suffix}${ext}`);
          index += 1;
        }
        if (isDirectory) fs.cpSync(sourcePath, destPath, { recursive: true, errorOnExist: true });
        else fs.copyFileSync(sourcePath, destPath, fs.constants.COPYFILE_EXCL);
        copies.push({ name: path.basename(destPath), path: destPath, isDirectory });
      }
      return copies;
    },

    async delete(filePath: string, options?: { permanent?: boolean }): Promise<RecycleBinEntry | undefined> {
      const check = checkWithinWorkspace(filePath);
      if (!check.ok) throw new Error(check.error);
      if (!fs.existsSync(filePath)) return undefined;
      if (options?.permanent) {
        fs.unlinkSync(filePath);
        return undefined;
      }
      return recycleBinService.moveToRecycleBin(filePath);
    },

    read(filePath: string) {
      const check = checkWithinWorkspace(filePath);
      if (!check.ok) throw new Error(check.error);
      return fs.readFileSync(filePath, 'utf-8');
    },

    readDir(dirPath: string) {
      const check = checkWithinWorkspace(dirPath);
      if (!check.ok) throw new Error(check.error);
      return fs.promises.readdir(dirPath);
    },

    async listDirectoryEntries(dirPath: string) {
      const check = checkWithinWorkspace(dirPath);
      if (!check.ok) throw new Error(check.error);
      const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
      const result = await Promise.all(entries
        .filter(entry => !entry.isSymbolicLink())
        .map(async entry => {
          const entryPath = path.join(dirPath, entry.name);
          const stat = await fs.promises.stat(entryPath);
          return { name: entry.name, path: entryPath, isDirectory: entry.isDirectory(), modifiedAt: stat.mtime.toISOString(), size: stat.size };
        }));
      return result.sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name, 'zh-CN'));
    },

    createFolder(params: { folderPath: string; folderName: string }) {
      const parentPath = path.resolve(String(params.folderPath || '').trim());
      const parentCheck = checkParentWithinWorkspace(parentPath);
      if (!parentCheck.ok) throw new Error(parentCheck.error);
      const rawName = String(params.folderName || '').trim();
      const nameCheck = checkSafeChildName(rawName);
      if (!nameCheck.ok) throw new Error(nameCheck.error);
      if (/[. ]$/.test(rawName)) throw new Error('文件夹名称不能以点或空格结尾');
      if (!fs.existsSync(parentPath)) fs.mkdirSync(parentPath, { recursive: true });
      const folderPath = path.join(parentPath, rawName);
      if (fs.existsSync(folderPath)) throw new Error('同名文件或文件夹已存在');
      fs.mkdirSync(folderPath);
      return folderPath;
    },

    createProjectFolder(params: { projectName: string; workspacePath: string }) {
      const { projectName, workspacePath } = params;
      const workspaceCheck = checkParentWithinWorkspace(workspacePath);
      if (!workspaceCheck.ok) throw new Error(workspaceCheck.error);
      const nameCheck = checkSafeChildName(projectName);
      if (!nameCheck.ok) throw new Error(nameCheck.error);
      if (!fs.existsSync(workspacePath)) fs.mkdirSync(workspacePath, { recursive: true });
      let folderName = projectName;
      let folderPath = path.join(workspacePath, folderName);
      let counter = 1;
      while (fs.existsSync(folderPath)) {
        folderName = `${projectName}-${counter}`;
        folderPath = path.join(workspacePath, folderName);
        counter += 1;
      }
      fs.mkdirSync(folderPath, { recursive: true });
      return folderPath;
    },

    async createBlank(params: { folderPath: string; fileName: string; fileType: string }) {
      const { folderPath, fileName } = params;
      const parentCheck = checkParentWithinWorkspace(folderPath);
      if (!parentCheck.ok) throw new Error(parentCheck.error);
      const nameCheck = checkSafeChildName(fileName);
      if (!nameCheck.ok) throw new Error(nameCheck.error);
      if (!fs.existsSync(folderPath)) fs.mkdirSync(folderPath, { recursive: true });
      const fileType = String(params.fileType || 'docx').replace(/^\./, '').toLowerCase();
      const filePath = path.join(folderPath, `${fileName}.${fileType}`);
      if (!fs.existsSync(filePath)) await creation.createByType(filePath, fileType);
      return filePath;
    },

    async generateFromContent(params: {
      template: WritingTemplate;
      sectionContents: Record<string, string>;
      folderPath: string;
      fileName: string;
    }) {
      const { template, sectionContents, folderPath, fileName } = params;
      const parentCheck = checkParentWithinWorkspace(folderPath);
      if (!parentCheck.ok) throw new Error(parentCheck.error);
      const nameCheck = checkSafeChildName(fileName);
      if (!nameCheck.ok) throw new Error(nameCheck.error);
      if (!fs.existsSync(folderPath)) fs.mkdirSync(folderPath, { recursive: true });
      const fileType = String(template.outputFileType || 'docx').replace(/^\./, '').toLowerCase();
      const filePath = path.join(folderPath, `${fileName}.${fileType}`);
      try {
        await creation.writeDocxWithContent(filePath, template, sectionContents);
        return filePath;
      } catch (error) {
        if (!isLockedFileError(error)) throw error;
        const availablePath = createAvailableSiblingPath(folderPath, fileName, fileType);
        await creation.writeDocxWithContent(availablePath, template, sectionContents);
        return availablePath;
      }
    },

    async createFromTemplate(params: { folderPath: string; fileName: string; template: WritingTemplate; fileType?: string }) {
      const { folderPath, fileName, template } = params;
      const parentCheck = checkParentWithinWorkspace(folderPath);
      if (!parentCheck.ok) throw new Error(parentCheck.error);
      const nameCheck = checkSafeChildName(fileName);
      if (!nameCheck.ok) throw new Error(nameCheck.error);
      if (!fs.existsSync(folderPath)) fs.mkdirSync(folderPath, { recursive: true });

      const outputFileType = String(params.fileType || template.outputFileType || 'docx').replace(/^\./, '').toLowerCase();
      const outputExt = `.${outputFileType}`;
      if (!template.filePath || !fs.existsSync(template.filePath)) {
        if (template.templateType !== 'example') throw new Error('直接套用模板的源文件不存在，请重新编辑模板并导入源文件');
        const destPath = path.join(folderPath, `${fileName}${outputExt}`);
        if (!fs.existsSync(destPath)) await creation.createByType(destPath, outputFileType, template);
        return destPath;
      }

      const sourceExt = path.extname(template.filePath).toLowerCase();
      if (template.templateType !== 'example') {
        const directDestPath = path.join(folderPath, `${fileName}${sourceExt || outputExt}`);
        fs.copyFileSync(template.filePath, directDestPath, fs.constants.COPYFILE_EXCL);
        return directDestPath;
      }
      const destPath = path.join(folderPath, `${fileName}${outputExt}`);
      if (sourceExt === outputExt && outputFileType !== 'docx') fs.copyFileSync(template.filePath, destPath, fs.constants.COPYFILE_EXCL);
      else await creation.createByType(destPath, outputFileType, template);
      return destPath;
    },
  };
}

export type FileSystemService = ReturnType<typeof createFileSystemService>;
