import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
export class Sqlite {
    private connection: DatabaseSync;
    private serial = 0;
    constructor(filename: string) { this.connection = new DatabaseSync(filename); }
    exec(sql: string) { this.connection.exec(sql); }
    pragma(sql: string) { this.connection.exec(`PRAGMA ${sql}`); }
    prepare(sql: string) {
        const s = this.connection.prepare(sql);
        return {
            get: (...v: unknown[]) => s.get(...v as SQLInputValue[]),
            all: (...v: unknown[]) => s.all(...v as SQLInputValue[]),
            run: (...v: unknown[]) => s.run(...v as SQLInputValue[]),
        };
    }
    transaction<T>(fn: () => T): () => T {
        return () => {
            const name = `operation_${++this.serial}`;
            this.exec(`SAVEPOINT ${name}`);
            try {
                const value = fn();
                this.exec(`RELEASE SAVEPOINT ${name}`);
                return value;
            }
            catch (e) {
                this.exec(`ROLLBACK TO SAVEPOINT ${name}`);
                this.exec(`RELEASE SAVEPOINT ${name}`);
                throw e;
            }
        };
    }
    close() { this.connection.close(); }
}
