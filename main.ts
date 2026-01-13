import { App, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile } from 'obsidian';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

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
			// Parse YAML frontmatter
			try {
				existingFrontmatter = yaml.load(match[1]) || {};
			} catch (error) {
				console.error('Failed to parse frontmatter as YAML:', error);
				// Fall back to empty frontmatter
			}
		}

		// Extract tags
		const tags = this.extractTags(existingFrontmatter, body);

		// Generate Hugo frontmatter
		const date = existingFrontmatter.date || new Date().toISOString();
		const title = existingFrontmatter.title || file.basename;
		const author = existingFrontmatter.author || this.settings.defaultAuthor || 'Unknown';

		let hugoFrontmatter = `---
title: "${title}"
date: ${date}
author: ${author}
draft: false
`;

		// Add tags if present
		if (tags.length > 0) {
			hugoFrontmatter += 'tags:\n';
			for (const tag of tags) {
				hugoFrontmatter += `  - ${tag}\n`;
			}
		}

		hugoFrontmatter += '---\n\n';

		return hugoFrontmatter + body;
	}

	extractTags(frontmatter: any, body: string): string[] {
		const tagSet = new Set<string>();

		// Extract tags from frontmatter (YAML parser gives us an array directly)
		if (frontmatter.tags) {
			if (Array.isArray(frontmatter.tags)) {
				// Tags are already an array from YAML parser
				frontmatter.tags.forEach((tag: string) => {
					if (tag) tagSet.add(tag);
				});
			} else if (typeof frontmatter.tags === 'string') {
				// Handle single tag as string
				tagSet.add(frontmatter.tags);
			}
		}

		// Extract inline tags from body (e.g., #tag)
		const inlineTagRegex = /#([a-zA-Z0-9_/-]+)/g;
		let tagMatch;
		while ((tagMatch = inlineTagRegex.exec(body)) !== null) {
			const tag = tagMatch[1];
			// Don't include tags that look like headings (followed by space)
			if (tagMatch.index === 0 || body[tagMatch.index - 1] !== '\n' || body[tagMatch.index + tagMatch[0].length] !== ' ') {
				tagSet.add(tag);
			}
		}

		return Array.from(tagSet).sort();
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
