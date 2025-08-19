import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";

export interface TagItem {
  id: string;
  name: string;
  filePath: string;
  group: string;
  description?: string;
  createdAt: number;
  createdBy?: string; // 添加创建者信息
  lastModified?: number;
  lastModifiedBy?: string;
}

export interface TagGroup {
  id: string;
  name: string;
  tags: TagItem[];
}

export interface TagDatabase {
  tags: TagItem[];
  groups: TagGroup[];
  version: number;
  lastSync: number;
}

export class TagManager {
  private context: vscode.ExtensionContext;
  private tags: Map<string, TagItem> = new Map();
  private groups: Map<string, TagGroup> = new Map();
  private readonly storageKey = "tagFinder.tags";
  private readonly groupsKey = "tagFinder.groups";
  private readonly dbFileName = ".vscode/tag-finder.json";
  private fileWatcher: vscode.FileSystemWatcher | undefined;
  private useWorkspaceStorage = false; // 是否使用工作区存储（协作模式）

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.initializeStorage();
    this.setupFileWatcher();
  }

  private async initializeStorage() {
    // 检查是否在工作区中，如果是则尝试使用协作模式
    if (
      vscode.workspace.workspaceFolders &&
      vscode.workspace.workspaceFolders.length > 0
    ) {
      const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
      const dbPath = path.join(workspaceRoot, this.dbFileName);

      try {
        // 检查是否已存在数据库文件
        if (fs.existsSync(dbPath)) {
          this.useWorkspaceStorage = true;
          await this.loadFromWorkspace();

          // 提示用户已自动启用协作模式
          const tagCount = this.tags.size;
          const userCount = this.getCollaborationInfo().userCount || 0;
          vscode.window
            .showInformationMessage(
              `已自动启用团队协作模式！当前有 ${tagCount} 个标签，${userCount} 位协作者。`,
              "查看详情"
            )
            .then((choice) => {
              if (choice === "查看详情") {
                vscode.commands.executeCommand("tagFinder.showCollabInfo");
              }
            });

          return;
        }

        // 询问用户是否启用协作模式
        const choice = await vscode.window.showInformationMessage(
          "是否启用团队协作模式？这将在工作区中创建共享的标签数据库文件。",
          "启用协作模式",
          "使用个人模式"
        );

        if (choice === "启用协作模式") {
          this.useWorkspaceStorage = true;
          await this.migrateToWorkspace();
          return;
        }
      } catch (error) {
        console.error("初始化工作区存储失败:", error);
      }
    }

    // 使用个人模式
    this.loadData();
  }

  private setupFileWatcher() {
    if (this.useWorkspaceStorage && vscode.workspace.workspaceFolders) {
      const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
      const dbPath = path.join(workspaceRoot, this.dbFileName);

      this.fileWatcher = vscode.workspace.createFileSystemWatcher(dbPath);
      this.fileWatcher.onDidChange(() => {
        this.loadFromWorkspace();
      });
    }
  }

  private async migrateToWorkspace() {
    // 将现有的个人数据迁移到工作区
    this.loadData();
    await this.saveToWorkspace();
  }

  private async loadFromWorkspace() {
    if (!vscode.workspace.workspaceFolders) {
      return;
    }

    const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
    const dbPath = path.join(workspaceRoot, this.dbFileName);

    try {
      if (fs.existsSync(dbPath)) {
        const data = JSON.parse(fs.readFileSync(dbPath, "utf8")) as TagDatabase;

        // 清空现有数据
        this.tags.clear();
        this.groups.clear();

        // 加载新数据
        data.tags.forEach((tag) => this.tags.set(tag.id, tag));
        data.groups.forEach((group) => this.groups.set(group.id, group));

        // 如果没有默认分组，创建一个
        if (this.groups.size === 0) {
          await this.createGroup("默认分组");
        }
      }
    } catch (error) {
      console.error("从工作区加载数据失败:", error);
      vscode.window.showErrorMessage("加载标签数据失败，请检查文件权限");
    }
  }

  private async saveToWorkspace() {
    if (!this.useWorkspaceStorage || !vscode.workspace.workspaceFolders) {
      return;
    }

    const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
    const vscodeDir = path.join(workspaceRoot, ".vscode");
    const dbPath = path.join(workspaceRoot, this.dbFileName);

    try {
      // 确保 .vscode 目录存在
      if (!fs.existsSync(vscodeDir)) {
        fs.mkdirSync(vscodeDir, { recursive: true });
      }

      const database: TagDatabase = {
        tags: Array.from(this.tags.values()),
        groups: Array.from(this.groups.values()),
        version: 1,
        lastSync: Date.now(),
      };

      fs.writeFileSync(dbPath, JSON.stringify(database, null, 2));
    } catch (error) {
      console.error("保存到工作区失败:", error);
      vscode.window.showErrorMessage("保存标签数据失败，请检查文件权限");
    }
  }

  private loadData() {
    // 加载标签数据
    const savedTags = this.context.globalState.get<TagItem[]>(
      this.storageKey,
      []
    );
    savedTags.forEach((tag) => {
      this.tags.set(tag.id, tag);
    });

    // 加载分组数据
    const savedGroups = this.context.globalState.get<TagGroup[]>(
      this.groupsKey,
      []
    );
    savedGroups.forEach((group) => {
      this.groups.set(group.id, group);
    });

    // 如果没有默认分组，创建一个
    if (this.groups.size === 0) {
      this.createGroup("默认分组");
    }
  }

  private async saveData() {
    if (this.useWorkspaceStorage) {
      await this.saveToWorkspace();
    } else {
      await this.context.globalState.update(
        this.storageKey,
        Array.from(this.tags.values())
      );
      await this.context.globalState.update(
        this.groupsKey,
        Array.from(this.groups.values())
      );
    }
  }

  // 检查标签名是否已存在
  private isTagNameExists(tagName: string, excludeTagId?: string): boolean {
    for (const tag of this.tags.values()) {
      if (tag.name === tagName && tag.id !== excludeTagId) {
        return true;
      }
    }
    return false;
  }

  // 检查文件是否已有标签
  private getTagForFile(filePath: string): TagItem | undefined {
    for (const tag of this.tags.values()) {
      if (tag.filePath === filePath) {
        return tag;
      }
    }
    return undefined;
  }

  // 获取当前用户名
  private getCurrentUser(): string {
    return process.env.USER || process.env.USERNAME || "Unknown";
  }

  public async addTag(
    filePath: string,
    tagName: string,
    groupId: string,
    description?: string
  ): Promise<TagItem | null> {
    // 检查标签名是否已存在
    if (this.isTagNameExists(tagName)) {
      vscode.window.showErrorMessage(
        `标签名 "${tagName}" 已存在，请使用其他名称`
      );
      return null;
    }

    // 检查文件是否已有标签（一对一限制）
    const existingTag = this.getTagForFile(filePath);
    if (existingTag) {
      const choice = await vscode.window.showWarningMessage(
        `文件 "${path.basename(filePath)}" 已有标签 "${
          existingTag.name
        }"，是否替换？`,
        "替换",
        "取消"
      );

      if (choice === "替换") {
        await this.removeTag(existingTag.id);
      } else {
        return null;
      }
    }

    const id = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const currentUser = this.getCurrentUser();
    const tag: TagItem = {
      id,
      name: tagName,
      filePath,
      group: groupId,
      description,
      createdAt: Date.now(),
      createdBy: currentUser,
      lastModified: Date.now(),
      lastModifiedBy: currentUser,
    };

    this.tags.set(id, tag);

    // 添加到对应的分组
    const group = this.groups.get(groupId);
    if (group) {
      group.tags.push(tag);
    }

    await this.saveData();
    return tag;
  }

  public async removeTag(tagId: string): Promise<boolean> {
    const tag = this.tags.get(tagId);
    if (!tag) {
      return false;
    }

    // 从分组中移除
    const group = this.groups.get(tag.group);
    if (group) {
      group.tags = group.tags.filter((t) => t.id !== tagId);
    }

    this.tags.delete(tagId);
    await this.saveData();
    return true;
  }

  public async editTag(
    tagId: string,
    newName: string,
    newDescription?: string
  ): Promise<boolean> {
    const tag = this.tags.get(tagId);
    if (!tag) {
      return false;
    }

    // 检查新标签名是否已存在（排除当前标签）
    if (this.isTagNameExists(newName, tagId)) {
      vscode.window.showErrorMessage(
        `标签名 "${newName}" 已存在，请使用其他名称`
      );
      return false;
    }

    // 更新标签信息（不允许修改文件路径和分组）
    tag.name = newName;
    if (newDescription !== undefined) {
      tag.description = newDescription;
    }
    tag.lastModified = Date.now();
    tag.lastModifiedBy = this.getCurrentUser();

    // 同时更新分组中的标签引用
    const group = this.groups.get(tag.group);
    if (group) {
      const tagIndex = group.tags.findIndex((t) => t.id === tagId);
      if (tagIndex !== -1) {
        group.tags[tagIndex] = tag;
      }
    }

    await this.saveData();
    return true;
  }

  public async createGroup(name: string): Promise<TagGroup> {
    const id = `group_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const group: TagGroup = {
      id,
      name,
      tags: [],
    };

    this.groups.set(id, group);
    await this.saveData();
    return group;
  }

  public async removeGroup(groupId: string): Promise<boolean> {
    const group = this.groups.get(groupId);
    if (!group) {
      return false;
    }

    // 移除分组中的所有标签
    group.tags.forEach((tag) => {
      this.tags.delete(tag.id);
    });

    this.groups.delete(groupId);
    await this.saveData();
    return true;
  }

  public searchTags(query: string): TagItem[] {
    const lowerQuery = query.toLowerCase();
    return Array.from(this.tags.values()).filter(
      (tag) =>
        tag.name.toLowerCase().includes(lowerQuery) ||
        tag.description?.toLowerCase().includes(lowerQuery) ||
        path.basename(tag.filePath).toLowerCase().includes(lowerQuery)
    );
  }

  public getAllTags(): TagItem[] {
    return Array.from(this.tags.values());
  }

  public getAllGroups(): TagGroup[] {
    return Array.from(this.groups.values());
  }

  public getGroup(groupId: string): TagGroup | undefined {
    return this.groups.get(groupId);
  }

  public getTagsByGroup(groupId: string): TagItem[] {
    const group = this.groups.get(groupId);
    return group ? group.tags : [];
  }

  public getTagsForFile(filePath: string): TagItem[] {
    return Array.from(this.tags.values()).filter(
      (tag) => tag.filePath === filePath
    );
  }

  // 设置文件删除监听器
  public setupFileDeleteWatcher() {
    if (vscode.workspace.workspaceFolders) {
      const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
      const pattern = new vscode.RelativePattern(workspaceRoot, "**/*");
      const deleteWatcher = vscode.workspace.createFileSystemWatcher(pattern);

      deleteWatcher.onDidDelete(async (uri) => {
        await this.handleFileDeleted(uri.fsPath);
      });

      return deleteWatcher;
    }
    return undefined;
  }

  // 处理文件删除事件
  private async handleFileDeleted(deletedFilePath: string) {
    const tagsToRemove = this.getTagsForFile(deletedFilePath);

    if (tagsToRemove.length > 0) {
      const tagNames = tagsToRemove.map((tag) => tag.name).join(", ");
      const choice = await vscode.window.showWarningMessage(
        `文件 "${path.basename(
          deletedFilePath
        )}" 已被删除，是否同时删除相关标签: ${tagNames}？`,
        "删除标签",
        "保留标签"
      );

      if (choice === "删除标签") {
        for (const tag of tagsToRemove) {
          await this.removeTag(tag.id);
        }
        vscode.window.showInformationMessage(
          `已删除 ${tagsToRemove.length} 个相关标签`
        );
      }
    }
  }

  // 清理无效标签（批量操作）
  public async cleanupInvalidTags(): Promise<number> {
    const invalidTags: TagItem[] = [];

    for (const tag of this.tags.values()) {
      if (!fs.existsSync(tag.filePath)) {
        invalidTags.push(tag);
      }
    }

    if (invalidTags.length > 0) {
      const choice = await vscode.window.showWarningMessage(
        `发现 ${invalidTags.length} 个无效标签（文件不存在），是否删除？`,
        "删除全部",
        "逐个确认",
        "取消"
      );

      if (choice === "删除全部") {
        for (const tag of invalidTags) {
          await this.removeTag(tag.id);
        }
        return invalidTags.length;
      } else if (choice === "逐个确认") {
        let deletedCount = 0;
        for (const tag of invalidTags) {
          const confirm = await vscode.window.showWarningMessage(
            `删除标签 "${tag.name}" (文件: ${path.basename(tag.filePath)})？`,
            "删除",
            "保留",
            "取消"
          );

          if (confirm === "删除") {
            await this.removeTag(tag.id);
            deletedCount++;
          } else if (confirm === "取消") {
            break;
          }
        }
        return deletedCount;
      }
    }

    return 0;
  }

  // 获取协作信息
  public getCollaborationInfo(): {
    mode: string;
    dbPath?: string;
    userCount?: number;
  } {
    if (this.useWorkspaceStorage && vscode.workspace.workspaceFolders) {
      const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
      const dbPath = path.join(workspaceRoot, this.dbFileName);

      // 统计不同用户
      const users = new Set<string>();
      for (const tag of this.tags.values()) {
        if (tag.createdBy) {
          users.add(tag.createdBy);
        }
        if (tag.lastModifiedBy) {
          users.add(tag.lastModifiedBy);
        }
      }

      return {
        mode: "团队协作模式",
        dbPath: dbPath,
        userCount: users.size,
      };
    }

    return { mode: "个人模式" };
  }

  // 销毁资源
  public dispose() {
    if (this.fileWatcher) {
      this.fileWatcher.dispose();
    }
  }
}
