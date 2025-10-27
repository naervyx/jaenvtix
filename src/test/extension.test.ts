import * as assert from 'assert';

interface VscodeApi {
        window: {
                showInformationMessage(message: string): unknown;
        };
}

let vscodeApi: VscodeApi | undefined;

suite('Extension Test Suite', function () {
        suiteSetup(async () => {
                try {
                        vscodeApi = (await import('vscode')) as VscodeApi;
                } catch {
                        vscodeApi = undefined;
                }
        });

        test('Sample test', function () {
                if (!vscodeApi) {
                        this.skip();
                        return;
                }

                vscodeApi.window.showInformationMessage('Start all tests.');

                assert.strictEqual(-1, [1, 2, 3].indexOf(5));
                assert.strictEqual(-1, [1, 2, 3].indexOf(0));
        });
});
