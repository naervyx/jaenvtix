import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import sinon from 'sinon';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import * as childProcess from 'child_process';

describe('jaenvtix.setup command', () => {
    let sandbox: sinon.SinonSandbox;

    beforeEach(() => {
        sandbox = sinon.createSandbox();
    });

    afterEach(() => {
        sandbox.restore();
    });

    const activateExtension = async () => {
        const extension = vscode.extensions.getExtension('naervyx.jaenvtix');
        assert.ok(extension, 'Extension should be found');
        await extension.activate();
    };

    const stubWorkspaceContext = () => {
        const workspaceFolder = {
            uri: vscode.Uri.file(path.join(__dirname, 'fixture-workspace')),
            name: 'fixture-workspace',
            index: 0
        } as vscode.WorkspaceFolder;

        sandbox.stub(vscode.workspace, 'workspaceFolders').value([workspaceFolder]);
        const getStub = sandbox.stub();
        getStub.withArgs('pythonPath').returns('python');
        sandbox.stub(vscode.workspace, 'getConfiguration').returns({ get: getStub } as any);

        return workspaceFolder;
    };

    const createOutputChannelMock = () => {
        return {
            name: 'Jaenvtix',
            append: sandbox.spy(),
            appendLine: sandbox.spy(),
            show: sandbox.spy()
        } as unknown as vscode.OutputChannel;
    };

    const stubProgress = () => {
        const progressReports: vscode.Progress<unknown>[] = [];
        const optionsSeen: vscode.ProgressOptions[] = [];

        const withProgressStub = sandbox.stub(vscode.window, 'withProgress').callsFake(
            async (options, task) => {
                optionsSeen.push(options);
                return task({
                    report: value => progressReports.push(value)
                } as vscode.Progress<unknown>);
            }
        );

        return { withProgressStub, optionsSeen, progressReports };
    };

    const stubMessages = () => {
        const info = sandbox.stub(vscode.window, 'showInformationMessage');
        const error = sandbox.stub(vscode.window, 'showErrorMessage');
        return { info, error };
    };

    const createFakeProcess = (exitCode: number, stdoutChunk = '', stderrChunk = '') => {
        const proc = new EventEmitter() as childProcess.ChildProcessWithoutNullStreams;
        const stdout = new PassThrough();
        const stderr = new PassThrough();
        proc.stdout = stdout;
        proc.stderr = stderr;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (proc as any).stdin = new PassThrough();

        setImmediate(() => {
            if (stdoutChunk) {
                stdout.emit('data', stdoutChunk);
            }
            if (stderrChunk) {
                stderr.emit('data', stderrChunk);
            }
            proc.emit('close', exitCode);
        });

        return proc;
    };

    it('runs successfully and reports output', async () => {
        const outputChannel = createOutputChannelMock();
        sandbox.stub(vscode.window, 'createOutputChannel').returns(outputChannel);
        await activateExtension();
        const workspaceFolder = stubWorkspaceContext();
        const { withProgressStub, optionsSeen } = stubProgress();
        const { info, error } = stubMessages();

        sandbox.stub(childProcess, 'spawn').callsFake(() =>
            createFakeProcess(0, 'stdout line', 'stderr line')
        );

        await vscode.commands.executeCommand('jaenvtix.setup');

        assert.strictEqual(withProgressStub.calledOnce, true, 'withProgress should be invoked');
        assert.strictEqual(optionsSeen[0].location, vscode.ProgressLocation.Notification);
        assert.ok(optionsSeen[0].title?.toString().includes('Jaenvtix'));

        const appendLineSpy = (outputChannel as any).appendLine as sinon.SinonSpy;
        const appendSpy = (outputChannel as any).append as sinon.SinonSpy;
        assert.strictEqual(appendLineSpy.calledWithMatch('Executando: python'), true);
        assert.strictEqual(
            appendLineSpy.calledWithMatch(workspaceFolder.uri.fsPath),
            true,
            'CWD should be logged'
        );
        assert.strictEqual(appendSpy.calledWithMatch('stdout line'), true);
        assert.strictEqual(appendSpy.calledWithMatch('stderr line'), true);

        assert.strictEqual(info.called, true, 'information message expected');
        assert.strictEqual(error.called, false, 'no error message expected');
    });

    it('surfaces failures from the Python process', async () => {
        const outputChannel = createOutputChannelMock();
        sandbox.stub(vscode.window, 'createOutputChannel').returns(outputChannel);
        await activateExtension();
        stubWorkspaceContext();
        const { error } = stubMessages();
        stubProgress();

        sandbox.stub(childProcess, 'spawn').callsFake(() => createFakeProcess(2, '', 'boom'));

        await assert.rejects(vscode.commands.executeCommand('jaenvtix.setup'), /Exit code 2/);

        const appendSpy = (outputChannel as any).append as sinon.SinonSpy;
        assert.strictEqual(appendSpy.calledWithMatch('boom'), true);
        assert.strictEqual(error.called, true, 'error message expected');
    });
});
