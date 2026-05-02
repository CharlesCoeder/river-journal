/**
 * Minimal stub for solito/navigation in Vitest/Node.js test environments.
 */
export const useRouter = () => ({
  push: (_href: string) => {},
  replace: (_href: string) => {},
  back: () => {},
})

export const usePathname = () => '/'

export const useLink = () => ({})
export const useParams = () => ({})
export const useSearchParams = () => ({})
