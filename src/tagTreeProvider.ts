import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { TagManager, TagItem, TagGroup } from "./tagManager";

// 辅助函数：检查文件是否存在且不为空
function checkFileExists(filePath: string): boolean {
  try {
    const stats = fs.statSync(filePath);
    return stats.isFile() && stats.size > 0;
  } catch (error) {
    return false;
  }
}

export class TagTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly type: "group" | "tag" | "file",
    public readonly data?: TagItem | TagGroup | string
  ) {
    super(label, collapsibleState);

    if (type === "tag" && data) {
      const tagData = data as TagItem;
      const fileExists = checkFileExists(tagData.filePath);

      this.tooltip = `标签: ${tagData.name}\n文件: ${tagData.filePath}\n分组: ${
        tagData.group
      }\n${tagData.description || ""}\n状态: ${
        fileExists ? "文件存在" : "文件不存在或为空"
      }`;
      this.description = tagData.description || "";
      this.contextValue = "tagItem";

      // 根据文件状态设置不同的图标和颜色
      if (fileExists) {
        this.iconPath = new vscode.ThemeIcon(
          "tag",
          new vscode.ThemeColor("charts.green")
        );
        this.command = {
          command: "tagFinder.openFile",
          title: "打开文件",
          arguments: [tagData.filePath],
        };
      } else {
        this.iconPath = new vscode.ThemeIcon(
          "tag",
          new vscode.ThemeColor("charts.red")
        );
        // 不设置 command，防止打开空文件
      }
    } else if (type === "group") {
      this.tooltip = `分组: ${label}`;
      this.contextValue = "groupItem";
      this.iconPath = new vscode.ThemeIcon("folder");
    } else if (type === "file") {
      this.tooltip = `文件: ${data as string}`;
      this.contextValue = "fileItem";
      this.iconPath = vscode.ThemeIcon.File;
      this.command = {
        command: "tagFinder.openFile",
        title: "打开文件",
        arguments: [data as string],
      };
    }
  }
}

export class TagTreeDataProvider
  implements vscode.TreeDataProvider<TagTreeItem>
{
  private _onDidChangeTreeData: vscode.EventEmitter<
    TagTreeItem | undefined | null | void
  > = new vscode.EventEmitter<TagTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<
    TagTreeItem | undefined | null | void
  > = this._onDidChangeTreeData.event;
  private viewMode: "group" | "file" = "group";

  constructor(private tagManager: TagManager) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  setViewMode(mode: "group" | "file"): void {
    this.viewMode = mode;
    this.refresh();
  }

  getTreeItem(element: TagTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TagTreeItem): Thenable<TagTreeItem[]> {
    if (!element) {
      if (this.viewMode === "group") {
        return this.getGroupView();
      } else {
        return this.getFileView();
      }
    } else if (element.type === "group" && element.data) {
      // 返回分组下的标签
      const group = element.data as TagGroup;
      return Promise.resolve(
        group.tags.map(
          (tag) =>
            new TagTreeItem(
              tag.name,
              vscode.TreeItemCollapsibleState.None,
              "tag",
              tag
            )
        )
      );
    } else if (element.type === "file" && element.data) {
      // 返回文件下的标签
      const filePath = element.data as string;
      const tags = this.tagManager.getTagsForFile(filePath);
      return Promise.resolve(
        tags.map(
          (tag) =>
            new TagTreeItem(
              tag.name,
              vscode.TreeItemCollapsibleState.None,
              "tag",
              tag
            )
        )
      );
    }

    return Promise.resolve([]);
  }

  private getGroupView(): Thenable<TagTreeItem[]> {
    const groups = this.tagManager.getAllGroups();
    return Promise.resolve(
      groups.map(
        (group) =>
          new TagTreeItem(
            `${group.name} (${group.tags.length})`,
            vscode.TreeItemCollapsibleState.Expanded,
            "group",
            group
          )
      )
    );
  }

  private getFileView(): Thenable<TagTreeItem[]> {
    const allTags = this.tagManager.getAllTags();
    const fileMap = new Map<string, TagItem[]>();

    // 按文件分组
    allTags.forEach((tag) => {
      if (!fileMap.has(tag.filePath)) {
        fileMap.set(tag.filePath, []);
      }
      fileMap.get(tag.filePath)!.push(tag);
    });

    const fileItems = Array.from(fileMap.entries()).map(([filePath, tags]) => {
      const fileName = path.basename(filePath);
      const relativePath = vscode.workspace.asRelativePath(filePath);
      return new TagTreeItem(
        `${fileName} (${tags.length})`,
        vscode.TreeItemCollapsibleState.Expanded,
        "file",
        filePath
      );
    });

    return Promise.resolve(fileItems);
  }
}

export class TagSearchProvider implements vscode.QuickPickItem {
  label: string;
  description: string;
  detail?: string;

  constructor(public tag: TagItem) {
    this.label = tag.name;
    this.description = path.basename(tag.filePath);
    this.detail = tag.description;
  }
}
