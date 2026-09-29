import { App, ColorComponent, Modal, Setting, getIconIds, setIcon } from "obsidian";
/** 常用 emoji，附带搜索关键词：[表情, 关键词]。 */
const EMOJIS: [string, string][] = [
  ["😀", "grinning 笑脸 哈哈"], ["😄", "smile 微笑 开心"], ["😂", "joy 大笑 喜极而泣"], ["😊", "blush 微笑 害羞"], ["😍", "heart-eyes 爱心眼 花痴"],
  ["🤔", "thinking 思考 疑惑"], ["😴", "sleeping 睡觉 困"], ["🥳", "party 庆祝 派对"], ["😎", "cool 酷 墨镜"], ["🥹", "touched 感动 含泪"],
  ["❤️", "heart red 爱心 红色"], ["🧡", "heart orange 爱心 橙色"], ["💛", "heart yellow 爱心 黄色"], ["💚", "heart green 爱心 绿色"], ["💙", "heart blue 爱心 蓝色"],
  ["💜", "heart purple 爱心 紫色"], ["🖤", "heart black 爱心 黑色"], ["🤍", "heart white 爱心 白色"], ["💖", "heart sparkling 爱心 闪亮"], ["💗", "heart growing 爱心 心动"],
  ["⭐", "star 星星"], ["🌟", "star glowing 星星 发光"], ["✨", "sparkles 闪光 亮晶晶"], ["🔥", "fire 火 火焰 热门"], ["⚡", "zap lightning 闪电"],
  ["💧", "droplet 水滴"], ["🌈", "rainbow 彩虹"], ["☀️", "sun 太阳"], ["🌙", "moon 月亮"], ["⛅", "cloud sun 多云"],
  ["📁", "folder 文件夹"], ["📂", "folder open 文件夹 打开"], ["🗂️", "card index 卡片 索引"], ["📚", "books 书籍"], ["📖", "book 书 阅读"],
  ["📝", "memo note 备忘 笔记"], ["📌", "pin 图钉 置顶"], ["📍", "pin round 定位 位置"], ["🔖", "bookmark 书签"], ["🏷️", "label tag 标签"],
  ["✅", "check done 对勾 完成"], ["☑️", "checkbox 复选框"], ["❌", "cross 叉 错误"], ["⭕", "circle 圆圈"], ["🟢", "circle green 圆 绿色"],
  ["🔴", "circle red 圆 红色"], ["🟡", "circle yellow 圆 黄色"], ["🔵", "circle blue 圆 蓝色"], ["🟣", "circle purple 圆 紫色"], ["🟠", "circle orange 圆 橙色"],
  ["🚀", "rocket 火箭"], ["✈️", "airplane 飞机"], ["🚗", "car 汽车"], ["🏠", "house home 家"], ["🏢", "office 办公室"],
  ["🏫", "school 学校"], ["⛺", "tent 帐篷"], ["🌍", "globe earth 地球 世界"], ["🗺️", "map 地图"], ["🧭", "compass 指南针 导航"],
  ["💡", "bulb idea 灯泡 想法"], ["🔍", "magnifier search 放大镜 搜索"], ["🔧", "wrench 扳手"], ["🔨", "hammer 锤子"], ["⚙️", "gear 齿轮 设置"],
  ["🛠️", "tools 工具"], ["🧰", "toolbox 工具箱"], ["💻", "laptop 笔记本电脑"], ["🖥️", "desktop 台式机 电脑"], ["📱", "phone 手机"],
  ["⌛", "hourglass 沙漏 时间"], ["⏰", "alarm clock 闹钟"], ["📅", "calendar 日历"], ["🗓️", "calendar spiral 台历 日历"], ["⏱️", "stopwatch 秒表 计时"],
  ["🧮", "abacus 算盘 计算"], ["💰", "money 钱 金钱"], ["💳", "credit card 信用卡"], ["🧾", "receipt 收据 账单"], ["💼", "briefcase 公文包 工作"],
  ["🎯", "target goal 目标 靶心"], ["🏆", "trophy 奖杯"], ["🥇", "medal gold 金牌 第一"], ["🏅", "medal 奖牌"], ["👑", "crown 皇冠"],
  ["💎", "gem diamond 钻石"], ["🔑", "key 钥匙"], ["🔒", "lock 锁 锁定"], ["🔓", "unlock 解锁"], ["🛡️", "shield 盾牌 保护"],
  ["📦", "package box 包裹 箱子"], ["🗃️", "card box 卡片盒"], ["🗄️", "file cabinet 文件柜"], ["🗑️", "trash 垃圾桶 删除"], ["📥", "inbox tray 收件箱 收集"],
  ["📤", "outbox tray 发件箱"], ["📮", "postbox 邮筒"], ["✉️", "envelope 信封"], ["📧", "email 邮件"], ["📨", "incoming 收件"],
  ["👤", "person 人"], ["👥", "people 人们 团队"], ["🧑‍💻", "technologist 程序员 电脑"], ["👨‍👩‍👧", "family 家庭"], ["🤝", "handshake 握手 合作"],
  ["👍", "thumbs up 点赞 好"], ["👎", "thumbs down 踩 差"], ["👏", "clap 鼓掌"], ["🙏", "pray thanks 祈祷 感谢"], ["💪", "muscle strong 肌肉 加油 力量"],
  ["🌱", "seedling 幼苗 成长"], ["🌲", "tree 树"], ["🌵", "cactus 仙人掌"], ["🍀", "clover 四叶草 幸运"], ["🌸", "blossom 樱花 花"],
  ["🌺", "hibiscus 花"], ["🍎", "apple 苹果"], ["🍊", "tangerine 橘子"], ["🍋", "lemon 柠檬"], ["🍉", "watermelon 西瓜"],
  ["☕", "coffee 咖啡"], ["🍵", "tea 茶"], ["🍺", "beer 啤酒"], ["🍷", "wine 红酒"], ["🥗", "salad 沙拉"],
  ["🍜", "ramen 拉面 面条"], ["🍣", "sushi 寿司"], ["🎂", "cake 蛋糕 生日"], ["🍪", "cookie 饼干"], ["🥛", "milk 牛奶"],
  ["🎵", "music 音乐"], ["🎧", "headphones 耳机"], ["🎬", "movie clapper 电影"], ["📷", "camera 相机 拍照"], ["🎨", "art paint 绘画 艺术"],
  ["🎮", "game 游戏"], ["🎲", "dice 骰子"], ["🧩", "puzzle 拼图"], ["🎁", "gift 礼物"], ["🎈", "balloon 气球"],
  ["⚠️", "warning 警告 注意"], ["❗", "exclamation 感叹号 重要"], ["❓", "question 问号 疑问"], ["💬", "speech chat 聊天 对话"], ["🔔", "bell 铃铛 通知"],
  ["🔕", "bell off 铃铛 静音"], ["📢", "megaphone 喇叭 公告"], ["🚩", "flag 旗帜"], ["🏁", "flag checkered 终点旗"], ["🔮", "crystal ball 水晶球 预测"],
  ["🧠", "brain 大脑 思考"], ["👀", "eyes 眼睛 查看"], ["💊", "pill 药丸 健康"], ["🩺", "stethoscope 听诊器 医疗"], ["🧘", "yoga meditate 瑜伽 冥想"],
  ["🏃", "running 跑步 运动"], ["🚴", "cycling 骑车 运动"], ["🏊", "swimming 游泳 运动"], ["⚽", "soccer 足球 运动"], ["🏀", "basketball 篮球 运动"],
  ["📊", "bar chart 柱状图 数据"], ["📈", "chart up 上升 趋势"], ["📉", "chart down 下降 趋势"], ["🗒️", "notepad 记事本"], ["🖊️", "pen 笔"],
  ["✂️", "scissors 剪刀"], ["🖇️", "paperclips 回形针"], ["📎", "paperclip 回形针"], ["📏", "ruler 尺子"], ["🧷", "safety pin 别针"],
];

/** Emoji 值以原始字符存储；图标 id 为 kebab-case ASCII。 */
export const isEmojiValue = (value: string): boolean => /[^\x20-\x7F]/.test(value);

/** 把 emoji 字符或 lucide/插件图标渲染到元素中。 */
export function renderIconValue(el: HTMLElement, value: string): void {
  if (isEmojiValue(value)) {
    el.addClass("para-emoji-icon");
    el.setText(value);
  } else {
    setIcon(el, value);
  }
}

type IconTab = "icon" | "emoji";

const MAX_TILES = 200;

/** 用于搜索和提示的显示名称。 */
function iconDisplayName(item: string): string {
  const emoji = EMOJIS.find(([glyph]) => glyph === item);
  if (emoji) return emoji[1];
  return item.replace(/^lucide-/, "");
}

/** 带标签页的选择器：图标库和 emoji 分属不同标签页，各自可搜索。 */
export class IconPickerModal extends Modal {
  private readonly onChoose: (iconId: string) => void;
  private tab: IconTab = "icon";
  private query = "";
  private listEl!: HTMLElement;
  private inputEl!: HTMLInputElement;
  private tabButtons = new Map<IconTab, HTMLButtonElement>();

  constructor(app: App, onChoose: (iconId: string) => void) {
    super(app);
    this.onChoose = onChoose;
  }

  onOpen(): void {
    const { contentEl, titleEl } = this;
    titleEl.setText("选择图标");

    const tabs = contentEl.createDiv("para-icon-tabs");
    const tabDefs: [IconTab, string][] = [
      ["icon", "图标"],
      ["emoji", "Emoji"],
    ];
    for (const [id, label] of tabDefs) {
      const button = tabs.createEl("button", { cls: "para-icon-tab", text: label });
      button.addEventListener("click", () => {
        this.tab = id;
        for (const [tabId, el] of this.tabButtons) el.toggleClass("is-active", tabId === id);
        this.renderList();
        this.inputEl.focus();
      });
      this.tabButtons.set(id, button);
    }
    this.tabButtons.get(this.tab)?.addClass("is-active");

    this.inputEl = contentEl.createEl("input", { cls: "para-icon-search" });
    this.inputEl.setAttr("type", "text");
    this.inputEl.setAttr("placeholder", "搜索图标名称…");
    this.inputEl.addEventListener("input", () => {
      this.query = this.inputEl.value.trim().toLowerCase();
      this.renderList();
    });
    this.inputEl.addEventListener("keydown", (evt) => {
      if (evt.key === "Enter") {
        evt.preventDefault();
        this.listEl.querySelector<HTMLElement>(".para-icon-tile")?.click();
      }
    });

    this.listEl = contentEl.createDiv("para-icon-grid");
    this.renderList();
    this.inputEl.focus();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private renderList(): void {
    this.listEl.empty();
    const items = this.tab === "emoji" ? EMOJIS.map(([glyph]) => glyph) : getIconIds();
    const query = this.query;
    let shown = 0;
    for (const item of items) {
      const name = iconDisplayName(item);
      if (query && !name.toLowerCase().includes(query)) continue;
      const tile = this.listEl.createDiv("para-icon-tile");
      tile.setAttr("title", name);
      tile.setAttr("aria-label", name);
      renderIconValue(tile, item);
      tile.addEventListener("click", () => {
        this.onChoose(item);
        this.close();
      });
      if (++shown >= MAX_TILES) break;
    }
    if (shown === 0) {
      this.listEl.createDiv({ cls: "para-icon-empty", text: "无匹配图标" });
    }
  }
}

/** 预设色板，始终可见。色板值为 hex；输入框接受任意 CSS 颜色。 */
const COLOR_PALETTE = [
  "#f14c4c", "#fa7970", "#e5b567", "#d29922", "#f0c674", "#ffd866", "#57ab5a", "#6fdd8b",
  "#a6d189", "#539bf5", "#79c0ff", "#6cb6ff", "#39c5cf", "#b083f0", "#d2a8ff", "#f778ba",
  "#ff9bce", "#c8a26a", "#8b949e", "#adbac7", "#e6edf3", "#ffffff", "#909dab", "#636e7b",
];

/** 接受 hex/rgb(a)/hsl(a)/CSS 颜色名；返回规范化后的值，无效时返回 null。 */
function parseColor(value: string): string | null {
  const probe = createSpan();
  probe.setCssStyles({ color: value.trim() });
  return probe.style.color || null;
}

/** 通用的危险操作确认框。 */
export class ConfirmModal extends Modal {
  private readonly message: string;
  private readonly confirmText: string;
  private readonly onConfirm: () => void;

  constructor(app: App, message: string, confirmText: string, onConfirm: () => void) {
    super(app);
    this.message = message;
    this.confirmText = confirmText;
    this.onConfirm = onConfirm;
  }

  onOpen(): void {
    const { contentEl, titleEl } = this;
    titleEl.setText("确认操作");
    contentEl.createEl("p", { text: this.message });
    new Setting(contentEl)
      .addButton((button) => button.setButtonText("取消").onClick(() => this.close()))
      .addButton((button) =>
        button
          .setButtonText(this.confirmText)
          .setDestructive()
          .onClick(() => {
            this.onConfirm();
            this.close();
          })
      );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/** 颜色选择器：自由输入（任意 CSS 颜色）+ 始终可见的色板。 */
export class ColorPickerModal extends Modal {
  private readonly current: string | null;
  private readonly onChoose: (color: string) => void;

  constructor(app: App, current: string | null, onChoose: (color: string) => void) {
    super(app);
    this.current = current;
    this.onChoose = onChoose;
  }

  onOpen(): void {
    const { contentEl, titleEl } = this;
    titleEl.setText("设置颜色");

    let value = this.current ?? "";
    let parsed = value ? parseColor(value) : null;

    const inputRow = contentEl.createDiv("para-color-input-row");
    const preview = inputRow.createSpan("para-color-preview");
    const input = inputRow.createEl("input", { cls: "para-color-input" });
    input.setAttr("type", "text");
    input.setAttr("placeholder", "#e5b567 · rgb(229,181,103) · gold");
    input.value = value;

    let confirmBtn: import("obsidian").ButtonComponent | null = null;

    const apply = (next: string): void => {
      value = next;
      input.value = next;
      parsed = parseColor(next);
      preview.style.backgroundColor = parsed ?? "transparent";
      input.toggleClass("is-invalid", next.length > 0 && parsed === null);
      confirmBtn?.setDisabled(parsed === null);
      if (parsed && /^#[0-9a-fA-F]{6}$/.test(parsed)) gradientPicker?.setValue(parsed);
    };

    // 原生渐变选择器（仅 hex）与自由输入框保持同步。
    const gradientWrap = inputRow.createDiv("para-color-gradient");
    const gradientPicker = new ColorComponent(gradientWrap);
    gradientPicker.setValue("#c8a26a").onChange((hex) => apply(hex));

    input.addEventListener("input", () => apply(input.value));
    input.addEventListener("keydown", (evt) => {
      if (evt.key === "Enter" && parsed) {
        evt.preventDefault();
        this.onChoose(parsed);
        this.close();
      }
    });

    const grid = contentEl.createDiv("para-color-grid");
    for (const swatch of COLOR_PALETTE) {
      const tile = grid.createDiv("para-color-tile");
      tile.style.backgroundColor = swatch;
      tile.setAttr("aria-label", swatch);
      tile.addEventListener("click", () => apply(swatch));
    }

    new Setting(contentEl).addButton((button) => {
      confirmBtn = button;
      button.setButtonText("确定").onClick(() => {
        if (!parsed) return;
        this.onChoose(parsed);
        this.close();
      });
    });

    apply(value || "#c8a26a");
    input.focus();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
