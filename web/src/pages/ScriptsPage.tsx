import { type ChangeEvent, type FormEvent, useEffect, useState } from 'react'
import {
  deleteScript,
  listScripts,
  uploadScript,
  type ScriptDocumentView,
} from '../api/client'
import { EmptyPanel } from '../components/EmptyPanel'
import { Icon } from '../components/Icon'

export function ScriptsPage() {
  const [scripts, setScripts] = useState<ScriptDocumentView[]>([])
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [selectedFile, setSelectedFile] = useState<File>()
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [deletingId, setDeletingId] = useState<string>()
  const [error, setError] = useState<string>()
  const [success, setSuccess] = useState<string>()

  async function loadData(background = false) {
    if (!background) {
      setLoading(true)
      setError(undefined)
    }

    try {
      const response = await listScripts()
      setScripts(response.scripts)
    } catch (loadError) {
      if (!background) {
        setError(loadError instanceof Error ? loadError.message : '加载剧本失败')
      }
    } finally {
      if (!background) {
        setLoading(false)
      }
    }
  }

  useEffect(() => {
    void loadData()
  }, [])

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    setSelectedFile(event.currentTarget.files?.[0])
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formElement = event.currentTarget
    setError(undefined)
    setSuccess(undefined)

    if (!selectedFile && !content.trim()) {
      setError('请上传文件，或粘贴剧本文本')
      return
    }

    setSubmitting(true)
    try {
      await uploadScript({
        title: title.trim() || undefined,
        file: selectedFile,
        content: selectedFile ? undefined : content.trim(),
      })
      setTitle('')
      setContent('')
      setSelectedFile(undefined)
      formElement.reset()
      await loadData(true)
      setSuccess('剧本已上传。')
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : '上传剧本失败')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDelete(scriptId: string) {
    setDeletingId(scriptId)
    setError(undefined)
    setSuccess(undefined)

    try {
      await deleteScript(scriptId)
      await loadData(true)
      setSuccess('剧本已删除。')
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : '删除剧本失败')
    } finally {
      setDeletingId(undefined)
    }
  }

  return (
    <div className="page page-scripts">
      <section className="scripts-layout">
        <article className="panel scripts-upload-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">剧本库</p>
              <h3>上传剧本与知识内容</h3>
            </div>
            <span className="subtle-text">{loading ? '正在刷新...' : `共 ${scripts.length} 条`}</span>
          </div>

          <form className="form-grid" onSubmit={handleSubmit}>
            <label className="field">
              <span>标题</span>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="例如：印尼客户开场话术、售后异议处理"
              />
            </label>

            <label className="script-upload-drop">
              <input
                type="file"
                accept=".txt,.md,.doc,.docx,.pdf,.csv,.json"
                onChange={handleFileChange}
              />
              <strong>{selectedFile ? selectedFile.name : '选择剧本或知识文件'}</strong>
              <span>支持 txt、md、doc、docx、pdf、csv、json，单个文件不超过 100MB。</span>
            </label>

            <label className="field script-content-field">
              <span>或直接粘贴文本</span>
              <textarea
                value={content}
                onChange={(event) => setContent(event.target.value)}
                placeholder="把常用话术、产品知识、客户问题处理流程粘贴到这里。"
                rows={10}
                disabled={Boolean(selectedFile)}
              />
            </label>

            <button className="primary-button" type="submit" disabled={submitting}>
              <Icon name="upload" />
              {submitting ? '上传中...' : '上传到剧本库'}
            </button>
          </form>
        </article>

        <article className="panel scripts-list-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">已上传内容</p>
              <h3>剧本列表</h3>
            </div>
          </div>

          {scripts.length > 0 ? (
            <div className="script-list">
              {scripts.map((script) => (
                <div key={script.id} className="script-card">
                  <div>
                    <strong>{script.title}</strong>
                    <span>{script.file_name}</span>
                  </div>
                  <div className="script-card-meta">
                    <span>{formatByteSize(script.byte_size)}</span>
                    <span>{formatDateTime(script.created_at)}</span>
                  </div>
                  <button
                    className="danger-button"
                    type="button"
                    disabled={deletingId === script.id}
                    onClick={() => void handleDelete(script.id)}
                  >
                    <Icon name="delete" />
                    {deletingId === script.id ? '删除中...' : '删除'}
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <EmptyPanel
              title="还没有剧本"
              description="上传话术、产品知识或流程文档后，后续可以把这些内容接入智能回复 Agent。"
            />
          )}
        </article>
      </section>

      {success ? <div className="success-banner">{success}</div> : null}
      {error ? <div className="error-banner">{error}</div> : null}
    </div>
  )
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function formatByteSize(value: number) {
  if (value < 1024) {
    return `${value} B`
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`
  }
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}
