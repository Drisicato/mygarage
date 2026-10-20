import api from '../../services/api'

/** GET a file from the API and save it, under the name the server gives it. */
export async function downloadFile(path: string, fallbackName: string): Promise<void> {
  const response = await api.get(path, { responseType: 'blob' })
  const disposition: string | undefined = response.headers['content-disposition']
  const filename = disposition?.match(/filename="(.+)"/)?.[1] ?? fallbackName
  const url = window.URL.createObjectURL(response.data)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  window.URL.revokeObjectURL(url)
}

/** The backup an import took of this vehicle before it wrote anything. */
export function downloadBackup(vin: string, filename: string): Promise<void> {
  return downloadFile(`/import/vehicles/${vin}/backups/${encodeURIComponent(filename)}`, filename)
}
