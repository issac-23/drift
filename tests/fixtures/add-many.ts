// Child process for the concurrency test: adds N tasks to DRIFT_DATA_FILE.
import { addTask } from '../../src/shared/store'

const [label, count] = process.argv.slice(2)
for (let i = 0; i < Number(count); i++) addTask({ title: `${label}-${i}`, category: 'work' })
