import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { useEffect, useMemo, useRef } from 'react'

marked.setOptions({ gfm: true, breaks: true })

export function Markdown({ content }: { content: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const html = useMemo(() => {
    const rendered = marked.parse(content || '', { async: false }) as string
    return DOMPurify.sanitize(rendered, {
      ADD_ATTR: ['target', 'rel']
    })
  }, [content])

  useEffect(() => {
    const element = ref.current
    if (!element) return
    const onClick = (event: MouseEvent): void => {
      const target = event.target as HTMLElement | null
      const anchor = target?.closest('a')
      if (!anchor) return
      event.preventDefault()
      const href = anchor.getAttribute('href')
      if (href && /^https?:\/\//i.test(href)) void window.api.openExternal(href)
    }
    element.addEventListener('click', onClick)
    return () => element.removeEventListener('click', onClick)
  }, [])

  return <div ref={ref} className="markdown" dangerouslySetInnerHTML={{ __html: html }} />
}
