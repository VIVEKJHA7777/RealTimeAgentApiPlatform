import { ArrowLeft, ArrowRight, Loader2, SearchX } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { DataStep, type DataChoice } from '@/components/apis/wizard/DataStep'
import { DetailsStep, type Details } from '@/components/apis/wizard/DetailsStep'
import { ReviewStep, type Phase } from '@/components/apis/wizard/ReviewStep'
import { WIZARD_STEPS } from '@/components/apis/wizard/steps'
import { WizardStepper } from '@/components/apis/wizard/WizardStepper'
import { EmptyState, ErrorState } from '@/components/PageStates'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ApiError, apisApi, dataSourcesApi, fieldErrorsOf, organizationsApi } from '@/lib/api'
import { suggestApiSlug, validateApiSlug } from '@/lib/api-slug'
import type { DataSource, FeedType, Organization } from '@/lib/api-types'
import { isImportActive } from '@/lib/imports'
import { normalizeSlugInput } from '@/lib/slug'
import { useFilePreview } from '@/lib/use-file-preview'
import { useRequest } from '@/lib/use-request'
import { compactErrors } from '@/lib/validation'

// "/brands/:slug/apis/new": the Create API wizard (1 Details → 2 Data → 3 Review).
export function CreateApiPage() {
  const { slug = '' } = useParams()
  const brand = useRequest(`organization:${slug}`, () => organizationsApi.get(slug).then((res) => res.organization))

  return (
    <div className="mx-auto max-w-3xl animate-in fade-in duration-300">
      <Link
        to={`/brands/${slug}`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        {brand.data?.name ?? 'Brand'}
      </Link>
      {brand.loading ? (
        <div className="mt-6 space-y-4" role="status" aria-label="Loading">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-96 rounded-2xl" />
        </div>
      ) : brand.error?.code === 'ORGANIZATION_NOT_FOUND' ? (
        <div className="mt-6">
          <EmptyState
            icon={SearchX}
            title="Brand not found"
            description="This brand doesn't exist, or it belongs to another account."
            action={
              <Button asChild variant="outline">
                <Link to="/">Back to your brands</Link>
              </Button>
            }
          />
        </div>
      ) : brand.error ? (
        <div className="mt-6">
          <ErrorState message={brand.error.message} onRetry={brand.reload} />
        </div>
      ) : (
        <Wizard organization={brand.data!} />
      )}
    </div>
  )
}

function Wizard({ organization }: { organization: Organization }) {
  const brandSlug = organization.slug
  const navigate = useNavigate()
  const existing = useRequest(`data-sources:${brandSlug}`, () =>
    dataSourcesApi.list(brandSlug).then((res) => res.dataSources),
  )

  const [step, setStep] = useState(1)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [details, setDetails] = useState<Details>({ name: '', slug: '', slugEdited: false, feedType: 'product' })
  const [checkingSlug, setCheckingSlug] = useState(false)

  const [choice, setChoice] = useState<DataChoice>('upload')
  const [idColumn, setIdColumn] = useState<string | null>(null)
  const [dataName, setDataName] = useState('')
  const [dataNameEdited, setDataNameEdited] = useState(false) // until typed in, follows the file name
  const [existingId, setExistingId] = useState<string | null>(null)
  const [uploadedId, setUploadedId] = useState<string | null>(null) // data uploaded by THIS wizard

  // File checks + instant preview (shared with "Upload new version"): lib/use-file-preview.ts.
  // The hook always calls the latest version of this callback, so it sees current state.
  const filePreview = useFilePreview(brandSlug, (preview, file) => {
    setIdColumn(preview.suggestedIdColumn)
    if (!dataNameEdited) setDataName(file.name)
  })
  const upload = filePreview.upload

  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const busyRef = useRef(false) // blocks double clicks instantly (state updates are async)
  const uploadAbort = useRef<AbortController | null>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)

  // Leaving the page: cancel a running upload (nothing half-done is kept). The preview hook
  // cancels its own request.
  useEffect(() => () => uploadAbort.current?.abort(), [])

  // Closing / reloading the tab during an upload: ask the browser to warn first.
  useEffect(() => {
    if (phase.kind !== 'uploading') return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [phase.kind])

  // Move keyboard / screen-reader focus to the new step's heading.
  function goTo(next: number) {
    setStep(next)
    requestAnimationFrame(() => headingRef.current?.focus())
  }

  function clearError(...fields: string[]) {
    setErrors((current) => {
      const copy = { ...current }
      for (const field of fields) delete copy[field]
      return copy
    })
  }

  // ── Step 1: details ────────────────────────────────────────────────────────────────────
  const suggestion = suggestApiSlug(details.name)

  function onNameChange(name: string) {
    setDetails((d) => ({ ...d, name, slug: d.slugEdited ? d.slug : suggestApiSlug(name) }))
    clearError('name', ...(details.slugEdited ? [] : ['slug']))
  }

  async function finishDetails() {
    const name = details.name.trim()
    const found = compactErrors({
      name: !name ? 'Name is required' : name.length > 100 ? 'Name must be at most 100 characters' : undefined,
      slug: validateApiSlug(details.slug),
    })
    setErrors(found)
    if (Object.keys(found).length > 0) return

    // Is the slug free? Asked now, so nobody uploads 200 MB to then hear "slug taken".
    // (The final create still handles the rare race where someone takes it in between.)
    setCheckingSlug(true)
    try {
      await apisApi.get(brandSlug, details.slug.trim())
      setErrors({ slug: 'This brand already has an API with this slug. Choose another one.' })
      return
    } catch (error) {
      if (!(error instanceof ApiError)) throw error
      if (error.code !== 'API_NOT_FOUND') {
        toast.error(error.message)
        return
      }
    } finally {
      setCheckingSlug(false)
    }
    goTo(2)
  }

  // ── Step 2: data ───────────────────────────────────────────────────────────────────────
  // Choosing a file: clear old errors and the old id column; the hook does the checks + preview.
  function onFile(file: File) {
    clearError('file', 'idColumn', 'dataName')
    setIdColumn(null)
    void filePreview.pick(file)
  }

  function clearFile() {
    filePreview.clear()
    setIdColumn(null)
    clearError('file', 'idColumn', 'dataName')
  }

  function finishData() {
    if (choice === 'existing') {
      if (!existingId || !existing.data?.some((ds) => ds.id === existingId)) {
        setErrors({ existing: 'Choose the data this API answers from' })
        return
      }
      goTo(3)
      return
    }
    if (upload.status !== 'ready') {
      setErrors({ file: upload.status === 'reading' ? 'Wait until the file has been read' : 'Choose a CSV file' })
      return
    }
    const name = dataName.trim()
    const taken = existing.data?.some((ds) => ds.name === name)
    const found = compactErrors({
      file: upload.preview.problems.length > 0 ? 'Fix the problems in the file first' : undefined,
      idColumn: !idColumn
        ? 'Choose the column that identifies a row'
        : !upload.preview.idCandidates.includes(idColumn)
          ? `"${idColumn}" is empty or repeats in the first rows, so the import would fail. Choose another column.`
          : undefined,
      dataName: !name
        ? 'Give this data a name'
        : name.length > 100
          ? 'Name must be at most 100 characters'
          : taken
            ? 'You already have data with this name. Choose another name, or use the existing data.'
            : undefined,
    })
    setErrors(found)
    if (Object.keys(found).length === 0) goTo(3)
  }

  // ── Step 3: create ─────────────────────────────────────────────────────────────────────
  async function create() {
    if (busyRef.current) return
    busyRef.current = true
    try {
      let dataSourceId = choice === 'existing' ? existingId : null

      if (dataSourceId === null) {
        if (upload.status !== 'ready' || !idColumn) return goTo(2)
        const controller = new AbortController()
        uploadAbort.current = controller
        setPhase({ kind: 'uploading', loaded: 0, total: upload.file.size })
        let created: DataSource
        try {
          const res = await dataSourcesApi.create(
            brandSlug,
            { file: upload.file, idColumn, name: dataName.trim() },
            { signal: controller.signal, onProgress: ({ loaded, total }) => setPhase({ kind: 'uploading', loaded, total }) },
          )
          created = res.dataSource
        } catch (error) {
          if (!(error instanceof ApiError)) throw error
          if (error.code === 'ABORTED') return
          return handleUploadError(error)
        }
        // The data now exists. Whatever happens next, it's never uploaded again: from here on
        // the wizard treats it as "existing data".
        dataSourceId = created.id
        setUploadedId(created.id)
        setChoice('existing')
        setExistingId(created.id)
        filePreview.clear()
        await existing.refresh()
      }

      setPhase({ kind: 'creating' })
      try {
        const { api } = await apisApi.create(brandSlug, {
          name: details.name.trim(),
          slug: details.slug.trim(),
          feedType: details.feedType,
          dataSourceId,
        })
        toast.success(`"${api.name}" created`)
        // replace: Back from the API page goes to the brand, not into a finished wizard
        navigate(`/brands/${brandSlug}/apis/${api.slug}`, { replace: true })
      } catch (error) {
        if (!(error instanceof ApiError)) throw error
        handleCreateError(error, dataSourceId === uploadedId || choice === 'upload')
      }
    } finally {
      busyRef.current = false
      setPhase((current) => (current.kind === 'creating' || current.kind === 'uploading' ? { kind: 'idle' } : current))
    }
  }

  function handleUploadError(error: ApiError) {
    if (error.isNetworkError) {
      toast.error(error.message)
      return
    }
    if (error.code === 'DATA_SOURCE_NAME_TAKEN') {
      setErrors({ dataName: 'You already have data with this name. Choose another name, or use the existing data.' })
      void existing.refresh()
    } else if (error.code === 'VALIDATION_ERROR') {
      const fields = fieldErrorsOf(error)
      setErrors(compactErrors({ idColumn: fields.idColumn, dataName: fields.name, file: fields.file ?? (!fields.idColumn && !fields.name ? error.message : undefined) }))
    } else {
      // The file itself (SOURCE_INVALID, ID_COLUMN_NOT_FOUND, FILE_TOO_LARGE, UNSUPPORTED_FILE…)
      filePreview.reject(upload.status === 'ready' ? upload.file : null, error)
    }
    goTo(2)
  }

  // justUploaded: the file was uploaded in this wizard, so tell the user it's kept.
  function handleCreateError(error: ApiError, justUploaded: boolean) {
    if (error.isNetworkError) {
      toast.error(justUploaded ? `${error.message} Your data is saved; press Create API again.` : error.message)
      return
    }
    if (error.code === 'API_SLUG_TAKEN') {
      setErrors({ slug: 'This slug was taken a moment ago. Choose another one.' })
      if (justUploaded) toast.info("Your data is saved. It won't be uploaded again.")
      goTo(1)
    } else if (error.code === 'DATA_SOURCE_NOT_FOUND') {
      setExistingId(null)
      setErrors({ existing: 'That data was just deleted. Choose other data, or upload a file.' })
      void existing.refresh()
      goTo(2)
    } else if (error.code === 'VALIDATION_ERROR') {
      const fields = fieldErrorsOf(error)
      setErrors(compactErrors({ name: fields.name, slug: fields.slug, feedType: fields.feedType }))
      goTo(fields.dataSourceId ? 2 : 1)
    } else {
      toast.error(error.message)
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (step === 1) void finishDetails()
    else if (step === 2) finishData()
    else void create()
  }

  const busy = phase.kind !== 'idle'
  const selectedExisting = existing.data?.find((ds) => ds.id === existingId)

  return (
    <>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">Create an API</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        An address Jivox can call for <span className="font-medium text-foreground">{organization.name}</span>, answering
        from data you upload.
      </p>

      <div className="mt-8">
        <WizardStepper current={step} onGoTo={(target) => !busy && goTo(target)} />
      </div>

      <form onSubmit={onSubmit} noValidate className="mt-6 rounded-2xl border bg-background p-5 shadow-sm sm:p-6">
        <h2 ref={headingRef} tabIndex={-1} className="text-lg font-semibold outline-none">
          {step === 1 ? 'Name and address' : step === 2 ? 'Data' : 'Review and create'}
        </h2>
        <p className="mt-1 mb-6 text-sm text-muted-foreground">
          {step === 1
            ? 'What the API is called and where Jivox will find it.'
            : step === 2
              ? 'Upload a CSV, or answer from data this brand already has.'
              : 'Check everything, then create the API.'}
        </p>

        <div key={step} className="animate-in fade-in slide-in-from-right-2 duration-200">
          {step === 1 && (
            <DetailsStep
              brandSlug={brandSlug}
              details={details}
              errors={errors}
              suggestion={suggestion}
              onNameChange={onNameChange}
              onSlugChange={(value) => {
                setDetails((d) => ({ ...d, slug: normalizeSlugInput(value), slugEdited: true }))
                clearError('slug')
              }}
              onUseSuggestion={() => {
                setDetails((d) => ({ ...d, slug: suggestion, slugEdited: false }))
                clearError('slug')
              }}
              onFeedTypeChange={(feedType: FeedType) => setDetails((d) => ({ ...d, feedType }))}
            />
          )}
          {step === 2 && (
            <DataStep
              choice={choice}
              onChoiceChange={(next) => {
                setChoice(next)
                clearError('file', 'idColumn', 'dataName', 'existing')
              }}
              upload={upload}
              onFile={onFile}
              onClearFile={clearFile}
              onRetryPreview={filePreview.retry}
              idColumn={idColumn}
              onIdColumnChange={(column) => {
                setIdColumn(column)
                clearError('idColumn')
              }}
              dataName={dataName}
              onDataNameChange={(name) => {
                setDataName(name)
                setDataNameEdited(true)
                clearError('dataName')
              }}
              dataSources={existing.data}
              existingId={existingId}
              onExistingChange={(id) => {
                setExistingId(id)
                clearError('existing')
              }}
              errors={errors}
            />
          )}
          {step === 3 && (
            <ReviewStep
              brandSlug={brandSlug}
              name={details.name}
              slug={details.slug}
              feedType={details.feedType}
              phase={phase}
              data={
                choice === 'upload' && upload.status === 'ready'
                  ? {
                      kind: 'upload',
                      fileName: upload.file.name,
                      fileSize: upload.file.size,
                      idColumn: idColumn ?? '',
                      dataName,
                      rows: upload.rows,
                      exactRows: upload.exactRows,
                    }
                  : {
                      kind: 'existing',
                      name: selectedExisting?.name ?? '',
                      idColumn: selectedExisting?.idColumn ?? '',
                      rowCount: selectedExisting?.rowCount ?? 0,
                      hasData: selectedExisting?.hasData ?? false,
                      importing: isImportActive(selectedExisting?.latestImport),
                    }
              }
            />
          )}
        </div>

        <div className="mt-8 flex flex-col-reverse gap-3 border-t pt-6 sm:flex-row sm:justify-between">
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="h-10"
            disabled={busy}
            onClick={() => (step === 1 ? navigate(`/brands/${brandSlug}`) : goTo(step - 1))}
          >
            {step === 1 ? 'Cancel' : (
              <>
                <ArrowLeft />
                Back
              </>
            )}
          </Button>
          <Button type="submit" size="lg" className="h-10" disabled={busy || checkingSlug || (step === 2 && upload.status === 'reading' && choice === 'upload')}>
            {(busy || checkingSlug) && <Loader2 className="animate-spin" />}
            {step < WIZARD_STEPS.length ? (
              <>
                {checkingSlug ? 'Checking…' : 'Next'}
                {!checkingSlug && <ArrowRight />}
              </>
            ) : phase.kind === 'uploading' ? (
              'Uploading…'
            ) : phase.kind === 'creating' ? (
              'Creating…'
            ) : (
              'Create API'
            )}
          </Button>
        </div>
      </form>
    </>
  )
}

