import * as assert from "assert";
import * as vscode from "vscode";
import { TagManager } from "../tagManager";

suite("TagManager Tests", () => {
  let tagManager: TagManager;
  let mockContext: vscode.ExtensionContext;

  suiteSetup(() => {
    // 创建模拟的扩展上下文
    mockContext = {
      globalState: {
        get: () => [],
        update: () => Promise.resolve(),
      },
    } as any;

    tagManager = new TagManager(mockContext);
  });

  test("应该能够创建标签分组", async () => {
    const group = await tagManager.createGroup("测试分组");
    assert.strictEqual(group.name, "测试分组");
    assert.strictEqual(group.tags.length, 0);
  });

  test("应该能够添加标签", async () => {
    // 首先创建一个分组
    const group = await tagManager.createGroup("测试分组2");

    // 添加标签
    const tag = await tagManager.addTag(
      "/test/file.js",
      "测试标签",
      group.id,
      "测试描述"
    );

    assert.ok(tag, "标签应该被成功创建");
    if (tag) {
      assert.strictEqual(tag.name, "测试标签");
      assert.strictEqual(tag.filePath, "/test/file.js");
      assert.strictEqual(tag.description, "测试描述");
    }
  });

  test("应该能够搜索标签", async () => {
    // 搜索标签
    const results = tagManager.searchTags("测试");
    assert.ok(results.length > 0, '应该找到包含"测试"的标签');
  });

  test("应该能够编辑标签", async () => {
    // 首先创建一个分组和标签
    const group = await tagManager.createGroup("测试分组3");
    const tag = await tagManager.addTag(
      "/test/file2.js",
      "原标签名",
      group.id,
      "原描述"
    );

    assert.ok(tag, "标签应该被成功创建");
    if (tag) {
      // 编辑标签
      const success = await tagManager.editTag(tag.id, "新标签名", "新描述");

      assert.strictEqual(success, true);

      // 验证标签已更新
      const allTags = tagManager.getAllTags();
      const updatedTag = allTags.find((t) => t.id === tag.id);
      assert.strictEqual(updatedTag?.name, "新标签名");
      assert.strictEqual(updatedTag?.description, "新描述");
      // 确保文件路径没有改变
      assert.strictEqual(updatedTag?.filePath, "/test/file2.js");
    }
  });

  test("应该能够获取所有标签", () => {
    const allTags = tagManager.getAllTags();
    assert.ok(allTags.length > 0, "应该有一些标签");
  });

  test("应该能够获取所有分组", () => {
    const allGroups = tagManager.getAllGroups();
    assert.ok(allGroups.length > 0, "应该有一些分组");
  });
});
