# Hugo Export Plugin for Obsidian

An Obsidian plugin that exports journal entries to Hugo with proper frontmatter formatting.

## Features

- Export individual notes from Obsidian to your Hugo blog
- Automatically converts Obsidian frontmatter to Hugo format
- Configurable export path and default author
- Command palette integration

## Installation

### For Development

1. Clone this repository to your local machine
2. Run `npm install` to install dependencies
3. Run `npm run build` to build the plugin
4. Copy `main.js`, `manifest.json`, and `styles.css` (if present) to your Obsidian vault's plugins folder:
   - On macOS: `~/Library/Application Support/obsidian/[your-vault]/.obsidian/plugins/hugo-export/`
   - On Windows: `%APPDATA%\obsidian\[your-vault]\.obsidian\plugins\hugo-export\`
   - On Linux: `~/.config/obsidian/[your-vault]/.obsidian/plugins/hugo-export/`
5. Reload Obsidian
6. Enable the plugin in Settings → Community Plugins

### Quick Development Setup

You can symlink the plugin folder directly to your Obsidian vault for easier development:

```bash
# Build the plugin
npm run build

# Create symlink (adjust paths as needed)
ln -s /Users/samf/hugo-obsidian-plugin ~/Library/Application\ Support/obsidian/[your-vault]/.obsidian/plugins/hugo-export
```

Then reload Obsidian and enable the plugin.

## Configuration

After installation, configure the plugin in Settings → Hugo Export:

1. **Hugo export path**: Set the path to your Hugo content directory (e.g., `/Users/you/blog/content/posts`)
2. **Default author**: Set your name to use in the author field

## Usage

1. Open a note you want to export to Hugo
2. Open the command palette (Cmd/Ctrl + P)
3. Run "Hugo Export: Export current note to Hugo"
4. The note will be exported to your configured Hugo content directory

## How It Works

The plugin:
- Reads the current note in Obsidian
- Extracts any existing frontmatter
- Converts it to Hugo-compatible frontmatter with fields: `title`, `date`, `author`, `draft`
- Saves the converted file to your Hugo content directory

## Development

### Building

```bash
npm run dev     # Watch mode for development
npm run build   # Production build
```

### Project Structure

- `main.ts` - Main plugin code
- `manifest.json` - Plugin metadata
- `esbuild.config.mjs` - Build configuration
- `tsconfig.json` - TypeScript configuration

## Roadmap

Potential future enhancements:
- Image/figure conversion and copying
- Batch export of multiple notes
- Custom frontmatter field mapping
- Support for Hugo shortcodes
- Tag conversion

## Related Projects

- [daypub](https://github.com/samf/daypub) - Converts Day One zip exports to Hugo

## License

MIT
