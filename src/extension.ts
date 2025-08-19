import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { TagManager, TagItem } from "./tagManager";
import { TagTreeDataProvider, TagSearchProvider } from "./tagTreeProvider";

export function activate(context: vscode.ExtensionContext) {
  console.log("Tag-Finder 插件已激活!");

  // 初始化标签管理器
  const tagManager = new TagManager(context);

  // 设置文件删除监听器
  const fileDeleteWatcher = tagManager.setupFileDeleteWatcher();
  if (fileDeleteWatcher) {
    context.subscriptions.push(fileDeleteWatcher);
  }

  // 创建树视图提供器
  const treeDataProvider = new TagTreeDataProvider(tagManager);

  // 注册树视图
  const treeView = vscode.window.createTreeView("tagFinderView", {
    treeDataProvider: treeDataProvider,
    showCollapseAll: true,
  });

  // 添加标签命令
  const addTagCommand = vscode.commands.registerCommand(
    "tagFinder.addTag",
    async (uri: vscode.Uri) => {
      if (!uri) {
        vscode.window.showErrorMessage("请在文件上右键使用此功能");
        return;
      }

      const filePath = uri.fsPath;

      // 获取所有分组
      const groups = tagManager.getAllGroups();
      if (groups.length === 0) {
        vscode.window.showErrorMessage("没有可用的分组，请先创建分组");
        return;
      }

      // 让用户输入标签名称
      const tagName = await vscode.window.showInputBox({
        prompt: "请输入标签名称",
        placeHolder: "例如: 用户登录功能",
        validateInput: (value) => {
          if (!value || value.trim().length === 0) {
            return "标签名称不能为空";
          }
          return null;
        },
      });

      if (!tagName) {
        return;
      }

      // 让用户选择分组
      const groupItems = groups.map((group) => ({
        label: group.name,
        description: `${group.tags.length} 个标签`,
        group: group,
      }));

      const selectedGroup = await vscode.window.showQuickPick(groupItems, {
        placeHolder: "选择分组",
      });

      if (!selectedGroup) {
        return;
      }

      // 让用户输入描述（可选）
      const description = await vscode.window.showInputBox({
        prompt: "请输入标签描述（可选）",
        placeHolder: "例如: 处理用户登录逻辑的核心文件",
      });

      try {
        const result = await tagManager.addTag(
          filePath,
          tagName.trim(),
          selectedGroup.group.id,
          description?.trim()
        );
        if (result) {
          treeDataProvider.refresh();
          vscode.window.showInformationMessage(
            `标签 "${tagName}" 已添加到文件 ${path.basename(filePath)}`
          );
        }
        // 如果 result 为 null，错误信息已经在 tagManager 中显示了
      } catch (error) {
        vscode.window.showErrorMessage(`添加标签失败: ${error}`);
      }
    }
  );

  // 搜索标签命令
  const searchTagsCommand = vscode.commands.registerCommand(
    "tagFinder.searchTags",
    async () => {
      const allTags = tagManager.getAllTags();

      if (allTags.length === 0) {
        vscode.window.showInformationMessage(
          "还没有任何标签，请先添加一些标签"
        );
        return;
      }

      const quickPickItems = allTags.map((tag) => new TagSearchProvider(tag));

      const selected = await vscode.window.showQuickPick(quickPickItems, {
        placeHolder: "搜索标签...",
        matchOnDescription: true,
        matchOnDetail: true,
      });

      if (selected) {
        await openFile(selected.tag.filePath);
      }
    }
  );

  // 编辑标签命令
  const editTagCommand = vscode.commands.registerCommand(
    "tagFinder.editTag",
    async (item) => {
      if (!item || !item.data || item.type !== "tag") {
        vscode.window.showErrorMessage("请选择一个标签来编辑");
        return;
      }

      const tag = item.data as TagItem;

      // 让用户输入新的标签名称
      const newTagName = await vscode.window.showInputBox({
        prompt: "请输入新的标签名称",
        value: tag.name,
        validateInput: (value) => {
          if (!value || value.trim().length === 0) {
            return "标签名称不能为空";
          }
          return null;
        },
      });

      if (!newTagName) {
        return;
      }

      // 让用户输入新的描述（可选）
      const newDescription = await vscode.window.showInputBox({
        prompt: "请输入新的标签描述（可选）",
        value: tag.description || "",
        placeHolder: "例如: 处理用户登录逻辑的核心文件",
      });

      try {
        const success = await tagManager.editTag(
          tag.id,
          newTagName.trim(),
          newDescription?.trim()
        );
        if (success) {
          treeDataProvider.refresh();
          vscode.window.showInformationMessage(`标签已更新为 "${newTagName}"`);
        } else {
          vscode.window.showErrorMessage("更新标签失败");
        }
      } catch (error) {
        vscode.window.showErrorMessage(`更新标签失败: ${error}`);
      }
    }
  );

  // 移除标签命令
  const removeTagCommand = vscode.commands.registerCommand(
    "tagFinder.removeTag",
    async (item) => {
      if (!item || !item.data || item.type !== "tag") {
        vscode.window.showErrorMessage("请选择一个标签来删除");
        return;
      }

      const tag = item.data as TagItem;
      const confirmed = await vscode.window.showWarningMessage(
        `确定要删除标签 "${tag.name}" 吗？`,
        "删除",
        "取消"
      );

      if (confirmed === "删除") {
        await tagManager.removeTag(tag.id);
        treeDataProvider.refresh();
        vscode.window.showInformationMessage(`标签 "${tag.name}" 已删除`);
      }
    }
  );

  // 刷新命令
  const refreshCommand = vscode.commands.registerCommand(
    "tagFinder.refresh",
    () => {
      treeDataProvider.refresh();
    }
  );

  // 打开文件命令
  const openFileCommand = vscode.commands.registerCommand(
    "tagFinder.openFile",
    async (filePath: string) => {
      await openFile(filePath);
    }
  );

  // 创建分组命令
  const createGroupCommand = vscode.commands.registerCommand(
    "tagFinder.createGroup",
    async () => {
      const groupName = await vscode.window.showInputBox({
        prompt: "请输入分组名称",
        placeHolder: "例如: 前端组件",
        validateInput: (value) => {
          if (!value || value.trim().length === 0) {
            return "分组名称不能为空";
          }
          return null;
        },
      });

      if (groupName) {
        await tagManager.createGroup(groupName.trim());
        treeDataProvider.refresh();
        vscode.window.showInformationMessage(`分组 "${groupName}" 已创建`);
      }
    }
  );

  // 切换视图模式命令
  const toggleViewModeCommand = vscode.commands.registerCommand(
    "tagFinder.toggleViewMode",
    async () => {
      const options = [
        { label: "按分组查看", description: "按标签分组显示", value: "group" },
        { label: "按文件查看", description: "按文件路径显示", value: "file" },
      ];

      const selected = await vscode.window.showQuickPick(options, {
        placeHolder: "选择视图模式",
      });

      if (selected) {
        treeDataProvider.setViewMode(selected.value as "group" | "file");
        vscode.window.showInformationMessage(`已切换到${selected.label}模式`);
      }
    }
  );

  // 清理无效标签命令
  const cleanupTagsCommand = vscode.commands.registerCommand(
    "tagFinder.cleanupTags",
    async () => {
      const deletedCount = await tagManager.cleanupInvalidTags();
      if (deletedCount > 0) {
        treeDataProvider.refresh();
        vscode.window.showInformationMessage(
          `已清理 ${deletedCount} 个无效标签`
        );
      } else {
        vscode.window.showInformationMessage("没有发现无效标签");
      }
    }
  );

  // 显示协作信息命令
  const showCollabInfoCommand = vscode.commands.registerCommand(
    "tagFinder.showCollabInfo",
    async () => {
      const info = tagManager.getCollaborationInfo();

      let message = `当前模式: ${info.mode}`;
      if (info.dbPath) {
        message += `\n数据库文件: ${info.dbPath}`;
      }
      if (info.userCount) {
        message += `\n协作用户数: ${info.userCount}`;
      }

      const totalTags = tagManager.getAllTags().length;
      const totalGroups = tagManager.getAllGroups().length;
      message += `\n标签总数: ${totalTags}`;
      message += `\n分组总数: ${totalGroups}`;

      vscode.window.showInformationMessage(message);
    }
  );

  // 注册所有命令
  context.subscriptions.push(
    addTagCommand,
    searchTagsCommand,
    editTagCommand,
    removeTagCommand,
    refreshCommand,
    openFileCommand,
    createGroupCommand,
    toggleViewModeCommand,
    cleanupTagsCommand,
    showCollabInfoCommand,
    treeView
  );

  // 在销毁时清理资源
  context.subscriptions.push({
    dispose: () => {
      tagManager.dispose();
    },
  });

  // 辅助函数：检查文件是否存在且不为空
  function checkFileExists(filePath: string): boolean {
    try {
      const stats = fs.statSync(filePath);
      return stats.isFile() && stats.size > 0;
    } catch (error) {
      return false;
    }
  }

  // 辅助函数：打开文件
  async function openFile(filePath: string) {
    try {
      // 检查文件是否存在且不为空
      if (!checkFileExists(filePath)) {
        vscode.window.showWarningMessage(
          `文件不存在或为空: ${path.basename(filePath)}`
        );
        return;
      }

      const document = await vscode.workspace.openTextDocument(filePath);
      await vscode.window.showTextDocument(document);
    } catch (error) {
      vscode.window.showErrorMessage(
        `无法打开文件: ${path.basename(filePath)}. 错误: ${error}`
      );
    }
  }
}

export function deactivate() {}
