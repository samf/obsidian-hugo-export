# hugo plugin for Obsidian

This is an [Obsidian](https://obsidian.md) [plugin](https://docs.obsidian.md/Home) for [Hugo](https://gohugo.io). There are others, but this is in line with the way that I use both Hugo and Obsidian.

## my workflow

My goal is to write journal entries in Obsidian. Some of them might be chosen to be published on my blog. When this happens, I want the plugin to export a new markdown file to another directory, outside of the Obsidian vault. The new file will have roughly the same content, but a metadata section appropriate for Hugo. Other changes might include the way that images (or "figures") are stored.

## other projects

Before Obsidian, I was using [Day One](https://dayoneapp.com/) for my writing. I wrote [daypub](https://github.com/samf/daypub) to convert the zip files exported from Day One into my Hugo blog.

## attachments

When the document we're exporting has attachments, referring to files within the Obsidian vault, we will copy these files into a folder that the user has configured.

### images

Images are the most often used form of attachments. We will make some transformations to the Obsidian markdown when we export to the hugo blog.

Here is how Obsidian deals with internal images: https://help.obsidian.md/embeds#Embed+an+image+in+a+note

Here is how Obsidian deals with external images: https://help.obsidian.md/syntax#External+images

Here is how Cloudflare Images can transform images: https://developers.cloudflare.com/images/transform-images/transform-via-url/

Here is documentation on Hugo's figure shortcode: https://gohugo.io/shortcodes/figure/

#### internal images

Obsidian's internal image syntax is `![[image-file]]` or `![[image-file|something]]`. The pipe content can be either:
- **Dimensions**: if it matches a numeric pattern like `500` or `500x300`, treat it as width (or width x height)
- **Alt text**: otherwise, treat it as alt text for the image

All internal images will be converted to Hugo figure shortcodes.

#### external images

External images use standard markdown syntax: `![alt text](url)`. These will also be converted to Hugo figure shortcodes.

#### captions

Figure captions are extracted from the image's EXIF metadata. The relevant fields are `ImageDescription`, `UserComment`, or IPTC `Caption-Abstract`.

#### Cloudflare Images

A user can configure support for Cloudflare Images as a checkbox. When enabled, the `src` attribute will use Cloudflare's transform URL format to resize images.

For an internal image like `![[photo.jpg|500]]`, the output would be:

```
{{<figure
    src="<root-of-your-website>/cdn-cgi/image/fit=scale-down,width=500/<your-attachment-prefix>/photo.jpg"
    link="<full URL for the attachment unmodified>"
    caption="<caption from EXIF, if any>"
/>}}
```

For external images, Cloudflare can also transform them if the zone has it configured:

```
{{<figure
    src="<root-of-your-website>/cdn-cgi/image/fit=scale-down,width=500/https://external-site.com/image.jpg"
    link="https://external-site.com/image.jpg"
/>}}
```

#### without Cloudflare Images

When Cloudflare Images is not enabled, we still use Hugo figure shortcodes, but the `src` points directly to the image without transformation:

```
{{<figure
    src="<your-attachment-prefix>/photo.jpg"
    link="<full URL for the attachment>"
    caption="<caption from EXIF, if any>"
/>}}
```

