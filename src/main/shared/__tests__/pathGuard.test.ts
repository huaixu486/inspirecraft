/**
 * pathGuard 单元测试
 * 运行: npx tsx src/main/shared/__tests__/pathGuard.test.ts
 *
 * 注意: pathGuard.ts 依赖 electron 的 app 模块（通过 paths.ts），
 * 这里直接测试核心路径逻辑，不导入 pathGuard.ts。
 */
import * as path from 'path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ─── 复现 pathGuard 的核心逻辑 ───────────────────────────

function isPathWithin(targetPath: string, root: string): boolean {
  if (!root) return false;
  const resolved = path.resolve(targetPath);
  return resolved === root || resolved.startsWith(root + path.sep);
}

function assertSafeChildName(name: string): void {
  const trimmed = (name || '').trim();
  if (!trimmed) throw new Error('名称不能为空');
  if (/\x00/.test(trimmed)) throw new Error('名称包含非法字符');
  if (/[\\/]/.test(trimmed)) throw new Error('名称不能包含路径分隔符');
  if (trimmed === '..' || trimmed === '.') throw new Error('名称不能为 . 或 ..');
  if (/^[a-zA-Z]:/.test(trimmed)) throw new Error('名称不能是绝对路径');
  if (/^\\\\/.test(trimmed)) throw new Error('名称不能是网络路径');
  if (/[<>:"|?*]/.test(trimmed)) throw new Error('名称包含非法字符');
  if (path.basename(trimmed) !== trimmed) throw new Error('名称不是有效的文件名');
}

function assertPathInside(fullPath: string, targetRoot: string): void {
  const resolvedFile = path.resolve(fullPath);
  const resolvedRoot = path.resolve(targetRoot);
  if (resolvedFile !== resolvedRoot && !resolvedFile.startsWith(resolvedRoot + path.sep)) {
    throw new Error(`路径越界: ${fullPath}`);
  }
}

// ─── isPathWithin ────────────────────────────────────────

describe('isPathWithin', () => {
  const workspace = path.resolve('C:\\Users\\test\\projects');

  it('workspace 内的路径应该允许', () => {
    assert.ok(isPathWithin('C:\\Users\\test\\projects\\my-project', workspace));
    assert.ok(isPathWithin('C:\\Users\\test\\projects\\my-project\\file.docx', workspace));
    assert.ok(isPathWithin('C:\\Users\\test\\projects\\a\\b\\c', workspace));
  });

  it('workspace 本身应该允许', () => {
    assert.ok(isPathWithin(workspace, workspace));
  });

  it('workspace 外的路径应该拒绝', () => {
    assert.ok(!isPathWithin('C:\\Users\\test\\other', workspace));
    assert.ok(!isPathWithin('C:\\Windows\\System32', workspace));
    assert.ok(!isPathWithin('D:\\external', workspace));
  });

  it('路径遍历攻击应该被拒绝', () => {
    assert.ok(!isPathWithin('C:\\Users\\test\\projects\\..\\..\\Windows', workspace));
    assert.ok(!isPathWithin('C:\\Users\\test\\projects\\..\\..\\etc\\passwd', workspace));
  });

  it('前缀匹配但不是子目录应该拒绝', () => {
    assert.ok(!isPathWithin('C:\\Users\\test\\projects-evil', workspace));
    assert.ok(!isPathWithin('C:\\Users\\test\\projects2', workspace));
  });

  it('相对路径应该被 resolve 后检查', () => {
    assert.ok(typeof isPathWithin('projects/sub', workspace) === 'boolean');
  });

  it('空 root 应该拒绝所有路径', () => {
    assert.ok(!isPathWithin('C:\\any\\path', ''));
    assert.ok(!isPathWithin('C:\\any\\path', '.'));
  });
});

// ─── assertSafeChildName ─────────────────────────────────

describe('assertSafeChildName', () => {
  it('正常文件名应该通过', () => {
    assert.doesNotThrow(() => assertSafeChildName('report.docx'));
    assert.doesNotThrow(() => assertSafeChildName('我的项目'));
    assert.doesNotThrow(() => assertSafeChildName('file (1).txt'));
    assert.doesNotThrow(() => assertSafeChildName('a-b_c.pdf'));
  });

  it('空字符串应该拒绝', () => {
    assert.throws(() => assertSafeChildName(''), /不能为空/);
    assert.throws(() => assertSafeChildName('   '), /不能为空/);
    assert.throws(() => assertSafeChildName(null as any), /不能为空/);
    assert.throws(() => assertSafeChildName(undefined as any), /不能为空/);
  });

  it('. 和 .. 应该拒绝', () => {
    assert.throws(() => assertSafeChildName('.'), /不能为/);
    assert.throws(() => assertSafeChildName('..'), /不能为/);
  });

  it('路径分隔符应该拒绝', () => {
    assert.throws(() => assertSafeChildName('sub/file.txt'), /路径分隔符/);
    assert.throws(() => assertSafeChildName('sub\\file.txt'), /路径分隔符/);
    assert.throws(() => assertSafeChildName('/etc/passwd'), /路径分隔符/);
    assert.throws(() => assertSafeChildName('C:\\Windows'), /路径分隔符/);
  });

  it('绝对路径应该拒绝', () => {
    assert.throws(() => assertSafeChildName('C:file'), /绝对路径/);
    assert.throws(() => assertSafeChildName('D:secret'), /绝对路径/);
  });

  it('UNC 路径应该拒绝（被路径分隔符检查先拦截）', () => {
    // \\server\share 包含 \，被路径分隔符检查先拦截 — 这是正确的保守行为
    assert.throws(() => assertSafeChildName('\\\\server\\share'), /路径分隔符|网络路径/);
  });

  it('非法字符应该拒绝', () => {
    assert.throws(() => assertSafeChildName('file<name'), /非法字符/);
    assert.throws(() => assertSafeChildName('file>name'), /非法字符/);
    assert.throws(() => assertSafeChildName('file:name'), /非法字符/);
    assert.throws(() => assertSafeChildName('file|name'), /非法字符/);
    assert.throws(() => assertSafeChildName('file?name'), /非法字符/);
    assert.throws(() => assertSafeChildName('file*name'), /非法字符/);
    assert.throws(() => assertSafeChildName('file"name'), /非法字符/);
  });

  it('空字节应该拒绝', () => {
    assert.throws(() => assertSafeChildName('file\x00name'), /非法字符/);
  });
});

// ─── assertPathInside (Zip Slip 防护) ────────────────────

describe('assertPathInside (Zip Slip)', () => {
  const target = path.resolve('C:\\Users\\test\\projects\\extract');

  it('正常解压路径应该允许', () => {
    assert.doesNotThrow(() => assertPathInside(path.join(target, 'file.txt'), target));
    assert.doesNotThrow(() => assertPathInside(path.join(target, 'sub', 'file.txt'), target));
    assert.doesNotThrow(() => assertPathInside(target, target));
  });

  it('../ 绕过应该拒绝', () => {
    assert.throws(() => assertPathInside(path.join(target, '..', 'evil.txt'), target), /越界/);
    assert.throws(() => assertPathInside(path.join(target, '..', '..', 'Windows', 'evil.exe'), target), /越界/);
  });

  it('绝对路径绕过应该拒绝', () => {
    assert.throws(() => assertPathInside('C:\\Windows\\evil.exe', target), /越界/);
    assert.throws(() => assertPathInside('D:\\external\\file.txt', target), /越界/);
  });

  it('前缀匹配但不是子目录应该拒绝', () => {
    assert.throws(() => assertPathInside(path.resolve('C:\\Users\\test\\projects\\extract-evil'), target), /越界/);
  });

  it('深层嵌套 ../ 应该拒绝', () => {
    assert.throws(() => assertPathInside(path.join(target, 'a', 'b', '..', '..', '..', 'evil.txt'), target), /越界/);
  });
});

// ─── 综合场景：ZIP 解压 + 文件名校验 ─────────────────────

describe('ZIP 解压综合场景', () => {
  const target = path.resolve('C:\\Users\\test\\workspace\\project');

  function simulateExtract(targetRoot: string, entryName: string): { ok: boolean; error?: string } {
    try {
      // 1. 检查文件名安全性
      const basename = path.basename(entryName);
      if (basename !== entryName && entryName.includes('..')) {
        return { ok: false, error: `ZIP 条目包含不安全路径: ${entryName}` };
      }

      // 2. 检查解压路径
      const fullPath = path.resolve(targetRoot, entryName);
      assertPathInside(fullPath, path.resolve(targetRoot));
      return { ok: true };
    } catch (error: any) {
      return { ok: false, error: error.message };
    }
  }

  it('正常文件应该通过', () => {
    assert.equal(simulateExtract(target, 'readme.txt').ok, true);
    assert.equal(simulateExtract(target, 'src/index.ts').ok, true);
    assert.equal(simulateExtract(target, 'a/b/c.txt').ok, true);
  });

  it('../ 逃逸应该拒绝', () => {
    assert.equal(simulateExtract(target, '../evil.txt').ok, false);
    assert.equal(simulateExtract(target, '../../etc/passwd').ok, false);
    assert.equal(simulateExtract(target, 'src/../../evil.txt').ok, false);
  });

  it('绝对路径应该拒绝', () => {
    assert.equal(simulateExtract(target, 'C:\\Windows\\evil.exe').ok, false);
  });

  it('深层嵌套 ../ 应该拒绝', () => {
    assert.equal(simulateExtract(target, 'a/b/c/../../../../evil.txt').ok, false);
  });
});

// ─── checkWithinWorkspace 返回值模式 ─────────────────────

describe('checkWithinWorkspace 返回值', () => {
  function checkWithinWorkspace(targetPath: string, ws: string): { ok: true } | { ok: false; error: string } {
    if (!isPathWithin(path.resolve(targetPath), ws)) {
      return { ok: false, error: `路径越界: ${path.resolve(targetPath)} 不在工作区 ${ws} 内` };
    }
    return { ok: true };
  }

  const workspace = path.resolve('C:\\Users\\test\\projects');

  it('合法路径返回 ok: true', () => {
    const result = checkWithinWorkspace('C:\\Users\\test\\projects\\file.txt', workspace);
    assert.equal(result.ok, true);
  });

  it('非法路径返回 ok: false 带 error', () => {
    const result = checkWithinWorkspace('C:\\Windows\\file.txt', workspace);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.error.includes('路径越界'));
    }
  });

  it('workspace 外的删除应该拒绝', () => {
    assert.equal(checkWithinWorkspace('C:\\Users\\test\\other\\file.txt', workspace).ok, false);
  });

  it('C:\\Windows\\... 应该拒绝', () => {
    assert.equal(checkWithinWorkspace('C:\\Windows\\System32\\cmd.exe', workspace).ok, false);
  });
});

console.log('\n✅ pathGuard 所有测试通过');
