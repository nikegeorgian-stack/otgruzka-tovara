/**
 * Увеличивает versionCode / versionName перед сборкой APK.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const gradlePath = path.join(root, 'fst-web', 'android', 'app', 'build.gradle')

let content = fs.readFileSync(gradlePath, 'utf8')
const codeMatch = content.match(/versionCode\s+(\d+)/)
const current = codeMatch ? Number.parseInt(codeMatch[1], 10) : 0
const nextCode = current + 1
const versionName = new Date().toISOString().slice(0, 10)

content = content.replace(/versionCode\s+\d+/, `versionCode ${nextCode}`)
content = content.replace(/versionName\s+"[^"]+"/, `versionName "${versionName}"`)
fs.writeFileSync(gradlePath, content, 'utf8')

console.log(`Android version: code=${nextCode} name=${versionName}`)
export const apkVersionCode = nextCode
export const apkVersionName = versionName
