import { App, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile } from 'obsidian';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import * as ExifReader from 'exifreader';

// Type definitions for image parsing
interface ParsedDimensions {
	width: number;
	height?: number;
}

interface ImageMetadata {
	dimensions?: ParsedDimensions;
	altText?: string;
}

interface ParsedInternalImage {
	filename: string;
	pipeContent?: string;
}

interface AttachmentInfo {
	newFilename: string;
	caption?: string;
}

interface FigureOptions {
	src: string;
	link?: string;
	alt?: string;
	caption?: string;
	width?: number;
	height?: number;
}

interface HugoExportSettings {
	hugoExportPath: string;
	hugoAttachmentsPath: string;
	hugoAttachmentsUrl: string;
	defaultAuthor: string;
	enableCloudflareImages: boolean;
	siteBaseUrl: string;
}

const DEFAULT_SETTINGS: HugoExportSettings = {
	hugoExportPath: '',
	hugoAttachmentsPath: '',
	hugoAttachmentsUrl: '/images',
	defaultAuthor: '',
	enableCloudflareImages: false,
	siteBaseUrl: ''
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
			let content = await this.app.vault.read(file);

			// Process internal attachments if attachments path is configured
			const attachmentMap = new Map<string, AttachmentInfo>();
			if (this.settings.hugoAttachmentsPath) {
				const attachments = this.findAttachments(content);
				for (const attachment of attachments) {
					const attachmentFile = await this.resolveAttachmentPath(attachment.filename, file);
					if (attachmentFile) {
						const info = await this.copyAttachment(attachmentFile, this.settings.hugoAttachmentsPath);
						attachmentMap.set(attachment.filename, info);
					} else {
						console.warn(`Attachment not found: ${attachment.filename}`);
					}
				}

				// Convert internal attachment links in content
				content = this.convertAttachmentLinks(content, attachmentMap, this.settings.hugoAttachmentsUrl);
			}

			// Convert external markdown images to Hugo figure shortcodes
			content = this.convertExternalImages(content);

			// Convert HTML <img> tags to Hugo figure shortcodes
			content = this.convertHtmlImages(content);

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

			const attachmentCount = attachmentMap.size;
			if (attachmentCount > 0) {
				new Notice(`Exported to: ${exportPath} (${attachmentCount} attachment${attachmentCount > 1 ? 's' : ''} copied)`);
			} else {
				new Notice(`Exported to: ${exportPath}`);
			}
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

	findAttachments(content: string): ParsedInternalImage[] {
		// Find Obsidian-style embeds: ![[filename]] or ![[filename|alt]]
		const embedRegex = /!\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
		const attachments: ParsedInternalImage[] = [];
		let match;

		while ((match = embedRegex.exec(content)) !== null) {
			attachments.push({
				filename: match[1],
				pipeContent: match[2]
			});
		}

		return attachments;
	}

	async resolveAttachmentPath(filename: string, sourceFile: TFile): Promise<TFile | null> {
		// Try to find the file in the vault
		// First, try as an exact path
		let file = this.app.vault.getAbstractFileByPath(filename);
		if (file instanceof TFile) {
			return file;
		}

		// Try with common extensions if no extension provided
		const hasExtension = /\.[^.]+$/.test(filename);
		if (!hasExtension) {
			const extensions = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'pdf'];
			for (const ext of extensions) {
				file = this.app.vault.getAbstractFileByPath(`${filename}.${ext}`);
				if (file instanceof TFile) {
					return file;
				}
			}
		}

		// Use Obsidian's link resolution (handles relative paths and vault search)
		const resolved = this.app.metadataCache.getFirstLinkpathDest(filename, sourceFile.path);
		if (resolved) {
			return resolved;
		}

		return null;
	}

	async copyAttachment(attachmentFile: TFile, destDir: string): Promise<AttachmentInfo> {
		// Read the attachment from the vault
		const content = await this.app.vault.readBinary(attachmentFile);

		// Extract EXIF caption before writing
		const caption = await this.extractExifCaption(content);

		// Sanitize the filename
		const sanitizedName = attachmentFile.name.replace(/[^a-z0-9.-]/gi, '-').toLowerCase();

		// Ensure destination directory exists
		if (!fs.existsSync(destDir)) {
			fs.mkdirSync(destDir, { recursive: true });
		}

		// Write to destination
		const destPath = path.join(destDir, sanitizedName);
		fs.writeFileSync(destPath, Buffer.from(content));

		return {
			newFilename: sanitizedName,
			caption
		};
	}

	convertAttachmentLinks(content: string, attachmentMap: Map<string, AttachmentInfo>, hugoImagePath: string): string {
		// Replace ![[filename]] or ![[filename|alt]] with Hugo figure shortcode
		return content.replace(/!\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (match, filename, pipeContent) => {
			const info = attachmentMap.get(filename);
			if (!info) {
				return match; // Not found, leave as-is
			}

			const metadata = this.parsePipeContent(pipeContent);
			const directUrl = `${hugoImagePath}/${info.newFilename}`;

			let src: string;
			let link: string | undefined;

			if (this.settings.enableCloudflareImages && this.settings.siteBaseUrl) {
				src = this.buildCloudflareImageUrl(directUrl, metadata.dimensions?.width);
				link = `${this.settings.siteBaseUrl.replace(/\/$/, '')}${directUrl}`;
			} else {
				src = directUrl;
				link = undefined;
			}

			return this.buildFigureShortcode({
				src,
				link,
				alt: metadata.altText,
				caption: info.caption,
				width: this.settings.enableCloudflareImages ? undefined : metadata.dimensions?.width,
				height: this.settings.enableCloudflareImages ? undefined : metadata.dimensions?.height
			});
		});
	}

	// Parse pipe content to determine if it's dimensions or alt text
	parsePipeContent(pipeContent: string | undefined): ImageMetadata {
		if (!pipeContent) {
			return {};
		}

		// Pattern: "500" (width only) or "500x300" (width x height)
		const dimensionPattern = /^(\d+)(?:x(\d+))?$/;
		const match = pipeContent.match(dimensionPattern);

		if (match) {
			return {
				dimensions: {
					width: parseInt(match[1], 10),
					height: match[2] ? parseInt(match[2], 10) : undefined
				}
			};
		}

		// Not dimensions, treat as alt text
		return {
			altText: pipeContent
		};
	}

	// Build a Hugo figure shortcode with the given options
	buildFigureShortcode(options: FigureOptions): string {
		const attrs: string[] = [];

		attrs.push(`src="${options.src}"`);

		if (options.link) {
			attrs.push(`link="${options.link}"`);
		}
		if (options.alt) {
			attrs.push(`alt="${options.alt}"`);
		}
		if (options.caption) {
			// Escape quotes in caption
			const escapedCaption = options.caption.replace(/"/g, '\\"');
			attrs.push(`caption="${escapedCaption}"`);
		}
		if (options.width) {
			attrs.push(`width="${options.width}"`);
		}
		if (options.height) {
			attrs.push(`height="${options.height}"`);
		}

		return `{{< figure ${attrs.join(' ')} >}}`;
	}

	// Build a Cloudflare Images transform URL
	buildCloudflareImageUrl(imagePath: string, width?: number): string {
		const baseUrl = this.settings.siteBaseUrl.replace(/\/$/, '');

		let transformOptions = 'fit=scale-down';
		if (width) {
			transformOptions += `,width=${width}`;
		}

		return `${baseUrl}/cdn-cgi/image/${transformOptions}${imagePath}`;
	}

	// Extract caption from EXIF metadata
	async extractExifCaption(buffer: ArrayBuffer): Promise<string | undefined> {
		try {
			const tags = ExifReader.load(buffer, { expanded: true }) as any;

			// Priority order: IPTC Caption-Abstract > ImageDescription > UserComment
			// Check IPTC first (most commonly used for captions)
			if (tags.iptc?.['Caption/Abstract']?.description) {
				return String(tags.iptc['Caption/Abstract'].description);
			}

			// Check EXIF ImageDescription
			if (tags.exif?.ImageDescription?.description) {
				return String(tags.exif.ImageDescription.description);
			}

			// Check EXIF UserComment
			if (tags.exif?.UserComment?.description) {
				return String(tags.exif.UserComment.description);
			}

			return undefined;
		} catch (error) {
			console.warn('Failed to extract EXIF caption:', error);
			return undefined;
		}
	}

	// Convert external markdown images to Hugo figure shortcodes
	convertExternalImages(content: string): string {
		// Pattern: ![alt](url) - but avoid matching already converted shortcodes
		return content.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, altOrDims, url) => {
			// Skip if it looks like it's already been processed or is not an image URL
			if (url.startsWith('{{') || url.startsWith('#')) {
				return match;
			}

			let alt: string | undefined;
			let dimensions: ParsedDimensions | undefined;

			// Check if alt contains dimensions: "alt|500" or "alt|500x300"
			const pipeIndex = altOrDims.lastIndexOf('|');
			if (pipeIndex !== -1) {
				const possibleDims = altOrDims.substring(pipeIndex + 1);
				const metadata = this.parsePipeContent(possibleDims);
				if (metadata.dimensions) {
					alt = altOrDims.substring(0, pipeIndex) || undefined;
					dimensions = metadata.dimensions;
				} else {
					alt = altOrDims || undefined;
				}
			} else {
				alt = altOrDims || undefined;
			}

			let src: string;
			let link: string | undefined;

			if (this.settings.enableCloudflareImages && this.settings.siteBaseUrl) {
				src = this.buildCloudflareImageUrl('/' + url, dimensions?.width);
				link = url;
			} else {
				src = url;
				link = undefined;
			}

			return this.buildFigureShortcode({
				src,
				link,
				alt,
				width: this.settings.enableCloudflareImages ? undefined : dimensions?.width,
				height: this.settings.enableCloudflareImages ? undefined : dimensions?.height
			});
		});
	}

	// Convert HTML <img> tags to Hugo figure shortcodes
	convertHtmlImages(content: string): string {
		// Pattern: <img ...> or <img ... />
		// This regex captures the entire tag and we'll parse attributes from it
		return content.replace(/<img\s+([^>]*)\/?>/gi, (match, attributesStr) => {
			// Parse attributes from the tag
			const attributes: Record<string, string> = {};
			const attrRegex = /(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/g;
			let attrMatch;

			while ((attrMatch = attrRegex.exec(attributesStr)) !== null) {
				const name = attrMatch[1].toLowerCase();
				const value = attrMatch[2] ?? attrMatch[3] ?? attrMatch[4];
				attributes[name] = value;
			}

			// Must have src attribute
			if (!attributes.src) {
				return match; // Leave as-is if no src
			}

			const imgSrc = attributes.src;
			const alt = attributes.alt;
			const width = attributes.width ? parseInt(attributes.width, 10) : undefined;
			const height = attributes.height ? parseInt(attributes.height, 10) : undefined;
			const title = attributes.title; // Can be used as caption

			let src: string;
			let link: string | undefined;

			if (this.settings.enableCloudflareImages && this.settings.siteBaseUrl) {
				// For Cloudflare, transform the URL
				const isExternal = imgSrc.startsWith('http://') || imgSrc.startsWith('https://');
				if (isExternal) {
					src = this.buildCloudflareImageUrl('/' + imgSrc, width);
					link = imgSrc;
				} else {
					src = this.buildCloudflareImageUrl(imgSrc.startsWith('/') ? imgSrc : '/' + imgSrc, width);
					link = `${this.settings.siteBaseUrl.replace(/\/$/, '')}${imgSrc.startsWith('/') ? imgSrc : '/' + imgSrc}`;
				}
			} else {
				src = imgSrc;
				link = undefined;
			}

			return this.buildFigureShortcode({
				src,
				link,
				alt,
				caption: title,
				width: this.settings.enableCloudflareImages ? undefined : width,
				height: this.settings.enableCloudflareImages ? undefined : height
			});
		});
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
			.setName('Hugo attachments path')
			.setDesc('Filesystem path for attachments/images (e.g., /Users/you/blog/static/images)')
			.addText(text => text
				.setPlaceholder('/path/to/hugo/static/images')
				.setValue(this.plugin.settings.hugoAttachmentsPath)
				.onChange(async (value) => {
					this.plugin.settings.hugoAttachmentsPath = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Hugo attachments URL')
			.setDesc('URL path for images in markdown (e.g., /images)')
			.addText(text => text
				.setPlaceholder('/images')
				.setValue(this.plugin.settings.hugoAttachmentsUrl)
				.onChange(async (value) => {
					this.plugin.settings.hugoAttachmentsUrl = value;
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

		new Setting(containerEl)
			.setName('Enable Cloudflare Images')
			.setDesc('Use Cloudflare Image transformations for resizing images')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableCloudflareImages)
				.onChange(async (value) => {
					this.plugin.settings.enableCloudflareImages = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Site base URL')
			.setDesc('Your site URL for Cloudflare Images (e.g., https://myblog.com)')
			.addText(text => text
				.setPlaceholder('https://myblog.com')
				.setValue(this.plugin.settings.siteBaseUrl)
				.onChange(async (value) => {
					this.plugin.settings.siteBaseUrl = value;
					await this.plugin.saveSettings();
				}));
	}
}
