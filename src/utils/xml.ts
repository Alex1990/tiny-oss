/**
 * Minimal XML tag extraction for OSS responses.
 *
 * OSS returns fixed-shape XML without namespaces, CDATA or nested
 * complexity, so a small regex-based extractor is enough and works in
 * environments without DOMParser (WeChat mini programs, Service
 * Workers). Match DOMParser semantics: missing tags yield ''.
 */

/**
 * Extract the text content of the first element with the given tag.
 */
export function getXmlTag(xml: string, tag: string): string {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(xml)
  return match ? match[1] : ''
}

/**
 * Extract the full elements (opening tag through closing tag) with the
 * given tag, in document order.
 */
export function getXmlTags(xml: string, tag: string): string[] {
  const regex = new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`, 'g')
  const tags: string[] = []
  let match: RegExpExecArray | null
  while ((match = regex.exec(xml)) !== null) {
    tags.push(match[0])
  }
  return tags
}
