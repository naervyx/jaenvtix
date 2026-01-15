export interface MavenDistribution {
    name: string;
    url: string;
    extension: string;
    version: string;
}

export interface MavenDownloadInfo {
    version: string;
    zipUrl: string;
    tarGzUrl: string;
}