import { useEffect, useRef, useState } from 'react'
import { EditorRoot, EditorContent, StarterKit, Placeholder } from 'novel'
import { Markdown } from 'tiptap-markdown'
import { generalClient } from '@/lib/generalClient'
import './ticket-editor.css'

interface SettingEditorProps {
  settingKey: string
  placeholder?: string
  className?: string
  editable?: boolean
}

export function SettingEditor({ settingKey, placeholder, className, editable = true }: SettingEditorProps) {
  const [content, setContent] = useState<string | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    generalClient.settingGet(settingKey).then((v) => setContent(v ?? ''))
  }, [settingKey])

  function handleUpdate(markdown: string) {
    if (!editable) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      generalClient.settingSet(settingKey, markdown)
    }, 500)
  }

  if (content === null) return null

  const extensions = [
    StarterKit,
    Placeholder.configure({ placeholder: placeholder ?? 'Start writing…' }),
    Markdown,
  ]

  return (
    <div className={className}>
      <EditorRoot>
        <EditorContent
          key={settingKey}
          extensions={extensions}
          editable={editable}
          onCreate={({ editor }) => {
            editor.commands.setContent(content, false)
          }}
          onUpdate={({ editor }) => {
            const markdown = (
              editor.storage.markdown as { getMarkdown: () => string }
            ).getMarkdown()
            handleUpdate(markdown)
          }}
          editorProps={{
            attributes: { class: 'ticket-prose focus:outline-none' },
          }}
        />
      </EditorRoot>
    </div>
  )
}
