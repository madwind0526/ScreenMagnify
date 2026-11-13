// Zips release/win-unpacked into release/ScreenMagnify-<version>.zip (top folder: ScreenMagnify/)
import { execFileSync } from 'node:child_process'
import { readFileSync, renameSync } from 'node:fs'
const { version } = JSON.parse(readFileSync('package.json', 'utf8'))
const zip = `ScreenMagnify-${version}.zip`
renameSync('release/win-unpacked', 'release/ScreenMagnify') // gives the archive a clean top folder
try {
  execFileSync(process.env.SystemRoot + '/System32/tar.exe', ['-a', '-cf', zip, 'ScreenMagnify'], { cwd: 'release', stdio: 'inherit' })
} finally {
  renameSync('release/ScreenMagnify', 'release/win-unpacked')
}
console.log('wrote release/' + zip)
