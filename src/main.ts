import { ItemView, Notice, Plugin, PluginSettingTab, type App, type WorkspaceLeaf } from 'obsidian';
import { PublisherService } from './service';
import { PublisherUI } from './ui';

const VIEW_TYPE = 'obsidian-social-publisher';
class PublisherView extends ItemView {
  private ui?: PublisherUI;
  constructor(leaf: WorkspaceLeaf, private service: PublisherService) { super(leaf); }
  getViewType(): string { return VIEW_TYPE; }
  getDisplayText(): string { return 'Social Publisher'; }
  getIcon(): string { return 'send'; }
  async onOpen(): Promise<void> { this.contentEl.empty(); this.ui = new PublisherUI(this.contentEl, this.service); await this.ui.mount(); }
  async onClose(): Promise<void> { this.ui?.destroy(); }
  refresh(): void { this.ui?.requestRefresh(); }
}
export default class SocialPublisherPlugin extends Plugin {
  service!: PublisherService;
  async onload(): Promise<void> {
    this.service = new PublisherService(this.app, this, text => new Notice(text));
    await this.service.load();
    this.registerView(VIEW_TYPE, leaf => new PublisherView(leaf, this.service));
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
  display():void{this.containerEl.empty();this.containerEl.createEl('h2',{text:'Social Publisher'});this.containerEl.createEl('p',{text:'内容目录、默认账号和本地浏览器连接在工作台的设置页管理。'});const button=this.containerEl.createEl('button',{text:'打开工作台'});button.onclick=()=>{void this.publisher.open();};}
}
