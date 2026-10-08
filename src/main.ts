import { ItemView, Notice, Plugin, PluginSettingTab, type App, type WorkspaceLeaf } from 'obsidian';
import { PublisherService } from './service';
import { PublisherUI, type PublisherRuntime } from './ui';

const VIEW_TYPE = 'obsidian-social-publisher';
class PublisherView extends ItemView {
  private ui?: PublisherUI;
  constructor(leaf: WorkspaceLeaf, private service: PublisherService, private runtime: PublisherRuntime) { super(leaf); }
  getViewType(): string { return VIEW_TYPE; }
  getDisplayText(): string { return 'Social Publisher'; }
  getIcon(): string { return 'send'; }
  async onOpen(): Promise<void> { this.contentEl.empty(); this.ui = new PublisherUI(this.contentEl, this.service, this.runtime); await this.ui.mount(); }
  async onClose(): Promise<void> { this.ui?.destroy(); }
  refresh(): void { this.ui?.requestRefresh(); }
}
export default class SocialPublisherPlugin extends Plugin {
  service!: PublisherService;
  async onload(): Promise<void> {
    this.service = new PublisherService(this.app, this, text => new Notice(text));
    await this.service.load();
    const runtime: PublisherRuntime = {
      version: this.manifest.version,
      vaultName: this.app.vault.getName(),
      openLogin: () => { void (require('electron') as {shell: {openExternal(url: string): Promise<void>}}).shell.openExternal('https://creator.xiaohongshu.com/').catch(() => new Notice('打开失败，请在浏览器访问 creator.xiaohongshu.com。')); },
      checkForUpdates: async () => {
        // BRAT's public command opens its single-plugin chooser; never update unrelated plugins.
        const commands = (this.app as App & {commands?: {executeCommandById(id: string): boolean}}).commands;
        if (!commands?.executeCommandById('obsidian42-brat:updateOnePlugin')) throw new Error('请先启用 BRAT，然后在 BRAT 设置中将本仓库版本设为 latest，再检查更新。');
        new Notice('在 BRAT 列表选择 zhangxun-ai/obsidian-social-publisher，确认最新版本；无需卸载。', 8000);
      }
    };
    this.registerView(VIEW_TYPE, leaf => new PublisherView(leaf, this.service, runtime));
    this.addRibbonIcon('send', '打开 Social Publisher', () => {void this.open();});
    this.addCommand({id:'open-workspace',name:'打开图文发布工作台',callback:()=>{void this.open();}});
    this.addSettingTab(new PublisherSettingsTab(this.app,this));
    // Debounced UI refresh never triggers preparation or platform actions.
    for (const event of ['create','modify','delete','rename'] as const) {
      this.registerEvent(this.app.vault.on(event as 'modify', () => {
        this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach(leaf => (leaf.view as PublisherView).refresh());
      }));
    }
  }
  async open(): Promise<void> {
    let leaf=this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if(!leaf){leaf=this.app.workspace.getLeaf('tab');await leaf.setViewState({type:VIEW_TYPE,active:true});}
    await this.app.workspace.revealLeaf(leaf);
  }
  onunload(): void { void this.service?.dispose(); }
}
class PublisherSettingsTab extends PluginSettingTab {
  constructor(app:App,private publisher:SocialPublisherPlugin){super(app,publisher);}
  display():void{this.containerEl.empty();this.containerEl.createEl('h2',{text:'Social Publisher'});this.containerEl.createEl('p',{text:'内容目录在设置页管理；登录与账号绑定在「平台与账号」中管理，更新无需卸载。'});const button=this.containerEl.createEl('button',{text:'打开工作台'});button.onclick=()=>{void this.publisher.open();};}
}
