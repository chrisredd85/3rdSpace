'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import {
  Archive,
  Download,
  Eye,
  File,
  FileImage,
  FileSpreadsheet,
  FileText,
  History,
  Loader2,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { supabase } from '@/lib/supabase/client'
import { useToast } from '@/components/ui/toast'

type DocumentType = 'coi' | 'contract' | 'invoice' | 'receipt' | 'other'

type StoredDocument = {
  id: string
  file_name: string | null
  file_url: string
  mime_type: string | null
  file_size: number | null
  document_type: DocumentType | null
  file_type?: string | null
  version?: number | null
  document_group_id?: string | null
  original_file_name?: string | null
  created_at: string | null
}

type DocumentItem = {
  id: string
  fileName: string
  originalFileName: string
  filePath: string
  fileUrl: string | null
  mimeType: string
  fileSize: number | null
  documentType: DocumentType
  fileType: string
  version: number
  documentGroupId: string
  createdAt: string | null
}

type UploadProgress = {
  active: boolean
  currentFile: string
  completed: number
  total: number
  percent: number
}

export interface DocumentFileLibraryProps {
  /**
   * Supabase Storage bucket for file bytes.
   */
  bucket: string
  /**
   * Folder prefix used inside the bucket.
   */
  folderPath: string
  /**
   * Related type stored on the documents row.
   */
  relatedType: 'event' | 'venue_booking' | 'vendor_booking' | 'user'
  /**
   * Related id stored on the documents row.
   */
  relatedId: string
  /**
   * Enables uploading and deletion.
   */
  canManage?: boolean
  /**
   * Accepted file input MIME/extension string.
   */
  accept?: string
  /**
   * Empty-state label.
   */
  emptyLabel?: string
}

/**
 * Displays, uploads, previews, filters, deletes, and versions document rows.
 */
export function DocumentFileLibrary({
  bucket,
  folderPath,
  relatedType,
  relatedId,
  canManage = true,
  accept = 'image/*,.pdf,.doc,.docx,.csv,.xls,.xlsx,.txt',
  emptyLabel = 'No files uploaded yet',
}: DocumentFileLibraryProps) {
  const [documents, setDocuments] = useState<DocumentItem[]>([])
  const [loading, setLoading] = useState(true)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [fileTypeFilter, setFileTypeFilter] = useState('all')
  const [previewDocument, setPreviewDocument] = useState<DocumentItem | null>(null)
  const [historyDocument, setHistoryDocument] = useState<DocumentItem | null>(null)
  const [uploadProgress, setUploadProgress] = useState<UploadProgress>({
    active: false,
    currentFile: '',
    completed: 0,
    total: 0,
    percent: 0,
  })
  const inputRef = useRef<HTMLInputElement>(null)
  const { addToast } = useToast()

  const loadDocuments = useCallback(async () => {
    setLoading(true)

    const { data, error } = await supabase
      .from('documents')
      .select('id, file_name, file_url, mime_type, file_size, document_type, file_type, version, document_group_id, original_file_name, created_at')
      .eq('related_type', relatedType)
      .eq('related_id', relatedId)
      .order('created_at', { ascending: false })

    if (error) {
      addToast({
        title: 'Could not load files',
        description: error.message,
        variant: 'destructive',
      })
      setLoading(false)
      return
    }

    const signedDocuments = await Promise.all(
      ((data as StoredDocument[] | null) || []).map(async (document) => mapStoredDocument(bucket, document))
    )

    setDocuments(signedDocuments)
    setLoading(false)
  }, [addToast, bucket, relatedId, relatedType])

  useEffect(() => {
    loadDocuments()
  }, [loadDocuments])

  const latestDocuments = useMemo(() => getLatestDocuments(documents), [documents])
  const filteredDocuments = useMemo(
    () => filterDocuments(latestDocuments, query, fileTypeFilter),
    [fileTypeFilter, latestDocuments, query]
  )
  const historyItems = useMemo(
    () => getDocumentHistory(documents, historyDocument),
    [documents, historyDocument]
  )

  /**
   * Uploads selected files and creates new versions for duplicate file names.
   */
  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || [])
    if (files.length === 0 || !canManage) return

    setUploadProgress({
      active: true,
      currentFile: files[0]?.name || '',
      completed: 0,
      total: files.length,
      percent: 5,
    })

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()

      if (userError || !user) {
        throw new Error('Please log in again before uploading files.')
      }

      for (const [index, file] of files.entries()) {
        const versionInfo = getNextVersionInfo(documents, file.name)
        const sanitizedName = sanitizeFileName(file.name)
        const storagePath = `${folderPath}/${versionInfo.documentGroupId}/v${versionInfo.version}-${Date.now()}-${sanitizedName}`

        setUploadProgress({
          active: true,
          currentFile: file.name,
          completed: index,
          total: files.length,
          percent: Math.max(8, Math.round((index / files.length) * 90)),
        })

        const { error: uploadError } = await supabase.storage
          .from(bucket)
          .upload(storagePath, file, {
            contentType: file.type || 'application/octet-stream',
            upsert: false,
          })

        if (uploadError) throw uploadError

        const insertPayload = {
          uploader_id: user.id,
          related_type: relatedType,
          related_id: relatedId,
          document_type: inferDocumentType(file),
          file_type: getFileType(file.type, file.name),
          file_name: file.name,
          original_file_name: versionInfo.originalFileName,
          document_group_id: versionInfo.documentGroupId,
          version: versionInfo.version,
          file_url: storagePath,
          file_size: file.size,
          mime_type: file.type || 'application/octet-stream',
        }

        const { error: insertError } = await supabase.from('documents').insert(insertPayload as never)

        if (insertError) {
          await supabase.storage.from(bucket).remove([storagePath])
          throw insertError
        }

        setUploadProgress({
          active: true,
          currentFile: file.name,
          completed: index + 1,
          total: files.length,
          percent: Math.round(((index + 1) / files.length) * 100),
        })
      }

      await loadDocuments()
      addToast({
        title: 'Files uploaded',
        description: `${files.length} file${files.length === 1 ? '' : 's'} uploaded successfully.`,
        variant: 'success',
      })
    } catch (error) {
      addToast({
        title: 'Upload failed',
        description: error instanceof Error ? error.message : 'Could not upload files.',
        variant: 'destructive',
      })
    } finally {
      setUploadProgress({
        active: false,
        currentFile: '',
        completed: 0,
        total: 0,
        percent: 0,
      })
      event.target.value = ''
    }
  }

  /**
   * Deletes one document version and its storage object.
   */
  async function deleteFile(document: DocumentItem) {
    if (!canManage) return

    setDeletingId(document.id)
    try {
      const { error: storageError } = await supabase.storage.from(bucket).remove([document.filePath])
      if (storageError) throw storageError

      const { error: deleteError } = await supabase.from('documents').delete().eq('id', document.id)
      if (deleteError) throw deleteError

      setDocuments((current) => current.filter((item) => item.id !== document.id))
      addToast({
        title: 'File deleted',
        description: `${document.fileName} has been removed.`,
      })
    } catch (error) {
      addToast({
        title: 'Delete failed',
        description: error instanceof Error ? error.message : 'Could not delete this file.',
        variant: 'destructive',
      })
    } finally {
      setDeletingId(null)
    }
  }

  /**
   * Opens a PDF in the preview modal or opens other files in a new tab.
   */
  function viewFile(document: DocumentItem) {
    if (!document.fileUrl) return
    if (isPdf(document)) {
      setPreviewDocument(document)
      return
    }
    window.open(document.fileUrl, '_blank', 'noopener,noreferrer')
  }

  /**
   * Downloads the signed file URL using the stored file name.
   */
  function downloadFile(document: DocumentItem) {
    if (!document.fileUrl) return
    const link = window.document.createElement('a')
    link.href = document.fileUrl
    link.download = document.fileName
    link.click()
  }

  if (loading) {
    return (
      <div className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
        Loading files...
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="grid flex-1 gap-3 md:grid-cols-[1fr_180px]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/60" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search files"
              className="pl-9"
            />
          </div>
          <select
            value={fileTypeFilter}
            onChange={(event) => setFileTypeFilter(event.target.value)}
            className="h-12 rounded-xl border-2 border-border bg-card/40 px-3 text-sm text-foreground outline-none transition-colors focus:border-primary"
          >
            <option value="all">All types</option>
            <option value="pdf">PDFs</option>
            <option value="image">Images</option>
            <option value="document">Documents</option>
            <option value="spreadsheet">Spreadsheets</option>
            <option value="other">Other</option>
          </select>
        </div>

        {canManage && (
          <div>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept={accept}
              onChange={handleUpload}
              className="hidden"
            />
            <Button type="button" variant="outline" onClick={() => inputRef.current?.click()} disabled={uploadProgress.active}>
              {uploadProgress.active ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
              Upload
            </Button>
          </div>
        )}
      </div>

      {uploadProgress.active && (
        <div className="rounded-lg border border-border bg-background p-3">
          <div className="mb-2 flex items-center justify-between gap-3 text-sm">
            <span className="truncate text-foreground">Uploading {uploadProgress.currentFile}</span>
            <span className="shrink-0 text-muted-foreground">
              {uploadProgress.completed}/{uploadProgress.total}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-sidebar-accent">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${uploadProgress.percent}%` }} />
          </div>
        </div>
      )}

      {filteredDocuments.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-8 text-center text-muted-foreground">
          <FileText className="mx-auto mb-3 h-12 w-12 opacity-50" />
          <p>{documents.length === 0 ? emptyLabel : 'No files match your filters'}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredDocuments.map((document) => {
            const Icon = getFileIcon(document.mimeType, document.fileType)
            const versionCount = documents.filter((item) => item.documentGroupId === document.documentGroupId).length

            return (
              <div
                key={document.id}
                className="flex items-center justify-between gap-4 rounded-lg border border-border p-4 transition-colors hover:border-border"
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-sidebar-accent/40 text-muted-foreground">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-foreground">{document.fileName}</p>
                    <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                      <span className="capitalize">{document.fileType}</span>
                      <span aria-hidden="true">•</span>
                      <span>{formatFileSize(document.fileSize)}</span>
                      {document.version > 1 && (
                        <>
                          <span aria-hidden="true">•</span>
                          <span className="text-primary">v{document.version}</span>
                        </>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Uploaded {formatDate(document.createdAt)}
                    </p>
                  </div>
                </div>

                <div className="flex shrink-0 gap-2">
                  <Button type="button" variant="secondary" size="icon" onClick={() => viewFile(document)} title="View" aria-label={`View ${document.fileName}`}>
                    <Eye className="h-4 w-4" />
                  </Button>
                  <Button type="button" variant="secondary" size="icon" onClick={() => downloadFile(document)} title="Download" aria-label={`Download ${document.fileName}`}>
                    <Download className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon"
                    onClick={() => setHistoryDocument(document)}
                    disabled={versionCount < 2}
                    title="Version history"
                    aria-label={`View version history for ${document.fileName}`}
                  >
                    <History className="h-4 w-4" />
                  </Button>
                  {canManage && (
                    <Button type="button" variant="secondary" size="icon" onClick={() => deleteFile(document)} disabled={deletingId === document.id} title="Delete" aria-label={`Delete ${document.fileName}`}>
                      {deletingId === document.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    </Button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {previewDocument && (
        <PdfPreviewModal document={previewDocument} onClose={() => setPreviewDocument(null)} />
      )}

      {historyDocument && (
        <VersionHistoryModal
          documents={historyItems}
          onClose={() => setHistoryDocument(null)}
          onView={viewFile}
          onDownload={downloadFile}
          onDelete={deleteFile}
          deletingId={deletingId}
          canManage={canManage}
        />
      )}
    </div>
  )
}

/**
 * Renders a PDF preview in a modal iframe.
 */
function PdfPreviewModal({ document, onClose }: { document: DocumentItem; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
      <div className="flex h-[85vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg bg-card/40 shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <p className="min-w-0 truncate font-semibold text-foreground">{document.fileName}</p>
          <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label="Close preview">
            <X className="h-4 w-4" />
          </Button>
        </div>
        <iframe src={document.fileUrl || ''} title={document.fileName} className="h-full w-full" />
      </div>
    </div>
  )
}

/**
 * Renders all versions for one document name/group.
 */
function VersionHistoryModal({
  documents,
  onClose,
  onView,
  onDownload,
  onDelete,
  deletingId,
  canManage,
}: {
  documents: DocumentItem[]
  onClose: () => void
  onView: (document: DocumentItem) => void
  onDownload: (document: DocumentItem) => void
  onDelete: (document: DocumentItem) => void
  deletingId: string | null
  canManage: boolean
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl overflow-hidden rounded-lg bg-card/40 shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <p className="font-semibold text-foreground">Version history</p>
            <p className="text-sm text-muted-foreground">{documents[0]?.originalFileName || documents[0]?.fileName}</p>
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label="Close version history">
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="max-h-[70vh] space-y-2 overflow-y-auto p-4">
          {documents.map((document) => (
            <div key={document.id} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
              <div className="min-w-0">
                <p className="font-semibold text-foreground">Version {document.version}</p>
                <p className="truncate text-sm text-muted-foreground">{document.fileName}</p>
                <p className="text-xs text-muted-foreground">
                  {formatFileSize(document.fileSize)} • {formatDate(document.createdAt)}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button type="button" variant="secondary" size="icon" onClick={() => onView(document)} title="View" aria-label={`View version ${document.version}`}>
                  <Eye className="h-4 w-4" />
                </Button>
                <Button type="button" variant="secondary" size="icon" onClick={() => onDownload(document)} title="Download" aria-label={`Download version ${document.version}`}>
                  <Download className="h-4 w-4" />
                </Button>
                {canManage && (
                  <Button type="button" variant="secondary" size="icon" onClick={() => onDelete(document)} disabled={deletingId === document.id} title="Delete" aria-label={`Delete version ${document.version}`}>
                    {deletingId === document.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/**
 * Converts a stored database row into a display document with a signed URL.
 */
async function mapStoredDocument(bucket: string, document: StoredDocument): Promise<DocumentItem> {
  const { data: signedUrlData } = await supabase.storage
    .from(bucket)
    .createSignedUrl(document.file_url, 60 * 60)

  const mimeType = document.mime_type || 'application/octet-stream'
  const fileName = document.file_name || document.file_url.split('/').pop() || 'Document'

  return {
    id: document.id,
    fileName,
    originalFileName: document.original_file_name || fileName,
    filePath: document.file_url,
    fileUrl: signedUrlData?.signedUrl || null,
    mimeType,
    fileSize: document.file_size,
    documentType: document.document_type || 'other',
    fileType: document.file_type || getFileType(mimeType, fileName),
    version: document.version || 1,
    documentGroupId: document.document_group_id || document.id,
    createdAt: document.created_at,
  }
}

/**
 * Returns the newest version for each document group.
 */
function getLatestDocuments(documents: DocumentItem[]) {
  const byGroup = new Map<string, DocumentItem>()

  for (const document of documents) {
    const current = byGroup.get(document.documentGroupId)
    if (!current || document.version > current.version) {
      byGroup.set(document.documentGroupId, document)
    }
  }

  return Array.from(byGroup.values()).sort((a, b) => {
    return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
  })
}

/**
 * Returns all versions for the selected document group.
 */
function getDocumentHistory(documents: DocumentItem[], selected: DocumentItem | null) {
  if (!selected) return []

  return documents
    .filter((document) => document.documentGroupId === selected.documentGroupId)
    .sort((a, b) => b.version - a.version)
}

/**
 * Filters files by query and file type.
 */
function filterDocuments(documents: DocumentItem[], query: string, fileTypeFilter: string) {
  const normalizedQuery = query.trim().toLowerCase()

  return documents.filter((document) => {
    const matchesQuery =
      !normalizedQuery ||
      document.fileName.toLowerCase().includes(normalizedQuery) ||
      document.documentType.toLowerCase().includes(normalizedQuery)
    const matchesType = fileTypeFilter === 'all' || document.fileType === fileTypeFilter

    return matchesQuery && matchesType
  })
}

/**
 * Determines the next version and stable group id for a selected file name.
 */
function getNextVersionInfo(documents: DocumentItem[], fileName: string) {
  const normalized = normalizeFileName(fileName)
  const matches = documents.filter((document) => normalizeFileName(document.originalFileName) === normalized)
  const latest = matches.reduce<DocumentItem | null>((current, document) => {
    if (!current || document.version > current.version) return document
    return current
  }, null)

  return {
    documentGroupId: latest?.documentGroupId || crypto.randomUUID(),
    originalFileName: latest?.originalFileName || fileName,
    version: latest ? latest.version + 1 : 1,
  }
}

/**
 * Infers a document classification from the name and MIME type.
 */
function inferDocumentType(file: File): DocumentType {
  const value = `${file.name} ${file.type}`.toLowerCase()
  if (value.includes('coi') || value.includes('insurance') || value.includes('certificate')) return 'coi'
  if (value.includes('contract') || value.includes('agreement')) return 'contract'
  if (value.includes('invoice')) return 'invoice'
  if (value.includes('receipt')) return 'receipt'
  return 'other'
}

/**
 * Returns a user-facing file type bucket.
 */
function getFileType(mimeType: string, fileName: string) {
  const value = `${mimeType} ${fileName}`.toLowerCase()
  if (value.includes('pdf')) return 'pdf'
  if (value.includes('image')) return 'image'
  if (value.includes('word') || value.endsWith('.doc') || value.endsWith('.docx') || value.includes('text/plain')) return 'document'
  if (value.includes('spreadsheet') || value.includes('excel') || value.includes('csv') || value.endsWith('.xls') || value.endsWith('.xlsx')) return 'spreadsheet'
  return 'other'
}

/**
 * Chooses a visual icon for a file.
 */
function getFileIcon(mimeType: string, fileType: string) {
  if (fileType === 'pdf') return FileText
  if (fileType === 'image' || mimeType.includes('image')) return FileImage
  if (fileType === 'spreadsheet') return FileSpreadsheet
  if (fileType === 'document') return File
  return Archive
}

/**
 * Formats bytes into a compact display string.
 */
function formatFileSize(bytes: number | null) {
  if (!bytes) return 'Unknown size'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Formats an upload date.
 */
function formatDate(value: string | null) {
  if (!value) return 'Unknown date'
  return new Date(value).toLocaleDateString()
}

/**
 * Returns whether the file can be shown in the PDF preview modal.
 */
function isPdf(document: DocumentItem) {
  return document.mimeType.includes('pdf') || document.fileName.toLowerCase().endsWith('.pdf')
}

/**
 * Normalizes file names for duplicate detection.
 */
function normalizeFileName(fileName: string) {
  return fileName.trim().toLowerCase()
}

/**
 * Sanitizes a file name before using it in a storage path.
 */
function sanitizeFileName(fileName: string) {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, '-').slice(-120) || 'file'
}
