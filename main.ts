import { App, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile } from 'obsidian';
import * as fs from 'fs';
import * as path from 'path';

interface HugoExportSettings {
	hugoExportPath: string;
	defaultAuthor: string;
}

const DEFAULT_SETTINGS: HugoExportSettings = {
	hugoExportPath: '',
	defaultAuthor: ''
};

export default class HugoExportPlugin extends Plugin {
	settings: HugoExportSettings;

	async onload() {
		await this.loadSettings();

		// Add command to export current note
		this.addCommand({
			id: 'export-to-hugo',
			name: 'Export current note to Hugo',
			checkCallback: (checking: boolean) => {
				const file = this.app.workspace.getActiveFile();
				if (file) {
					if (!checking) {
						this.exportToHugo(file);
					}
					return true;
				}
				return false;
			}
		});

		// Add settings tab
		this.addSettingTab(new HugoExportSettingTab(this.app, this));
	}

	onunload() {
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async exportToHugo(file: TFile) {
		if (!this.settings.hugoExportPath) {
			new Notice('Please set the Hugo export path in settings first');
			return;
		}

		try {
			const content = await this.app.vault.read(file);
			const hugoContent = this.convertToHugo(content, file);

			// Create filename based on date and title
			const filename = this.generateHugoFilename(file);
			const exportPath = path.join(this.settings.hugoExportPath, filename);

			// Ensure directory exists
			const dir = path.dirname(exportPath);
			if (!fs.existsSync(dir)) {
				fs.mkdirSync(dir, { recursive: true });
			}

			// Write the file
			fs.writeFileSync(exportPath, hugoContent, 'utf-8');
			new Notice(`Exported to: ${exportPath}`);
		} catch (error) {
			console.error('Export failed:', error);
			new Notice(`Export failed: ${error.message}`);
		}
	}

	convertToHugo(content: string, file: TFile): string {
		// Extract existing frontmatter if present
		const frontmatterRegex = /^---\n([\s\S]*?)\n---\n/;
		const match = content.match(frontmatterRegex);

		let body = content;
		let existingFrontmatter: any = {};

		if (match) {
			body = content.slice(match[0].length);
			// Parse existing frontmatter (simple key: value parsing)
			const lines = match[1].split('\n');
			for (const line of lines) {
				const colonIndex = line.indexOf(':');
				if (colonIndex > 0) {
					const key = line.slice(0, colonIndex).trim();
					const value = line.slice(colonIndex + 1).trim();
					existingFrontmatter[key] = value;
				}
			}
		}

		// Generate Hugo frontmatter
		const date = existingFrontmatter.date || new Date().toISOString();
		const title = existingFrontmatter.title || file.basename;
		const author = existingFrontmatter.author || this.settings.defaultAuthor || 'Unknown';

		const hugoFrontmatter = `---
title: "${title}"
date: ${date}
author: ${author}
draft: false
---

`;

		return hugoFrontmatter + body;
	}

	generateHugoFilename(file: TFile): string {
		// Use the original filename or create one based on date
		const basename = file.basename;
		const sanitized = basename.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
		return `${sanitized}.md`;
	}
}

class HugoExportSettingTab extends PluginSettingTab {
	plugin: HugoExportPlugin;

	constructor(app: App, plugin: HugoExportPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('Hugo export path')
			.setDesc('Path to your Hugo content directory (e.g., /Users/you/blog/content/posts)')
			.addText(text => text
				.setPlaceholder('/path/to/hugo/content/posts')
				.setValue(this.plugin.settings.hugoExportPath)
				.onChange(async (value) => {
					this.plugin.settings.hugoExportPath = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Default author')
			.setDesc('Your name to use in the author field')
			.addText(text => text
				.setPlaceholder('Your Name')
				.setValue(this.plugin.settings.defaultAuthor)
				.onChange(async (value) => {
					this.plugin.settings.defaultAuthor = value;
					await this.plugin.saveSettings();
				}));
	}
}
