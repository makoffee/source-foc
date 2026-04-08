const {series, watch, src, dest, parallel} = require('gulp');
const pump = require('pump');
const path = require('path');
const releaseUtils = require('@tryghost/release-utils');
const inquirer = require('inquirer');

// gulp plugins and utils
const livereload = require('gulp-livereload');
const postcss = require('gulp-postcss');
const zip = require('gulp-zip');
const concat = require('gulp-concat');
const uglify = require('gulp-uglify');
const beeper = require('beeper');
const fs = require('fs');

// postcss plugins
const autoprefixer = require('autoprefixer');
const cssnano = require('cssnano');
const easyimport = require('postcss-easy-import');

const REPO = 'TryGhost/Source';
const REPO_READONLY = 'TryGhost/Source';
const CHANGELOG_PATH = path.join(process.cwd(), '.', 'changelog.md');

function serve(done) {
    livereload.listen();
    done();
}

const handleError = (done) => {
    return function (err) {
        if (err) {
            beeper();
        }
        return done(err);
    };
};

function hbs(done) {
    pump([
        src(['*.hbs', 'partials/**/*.hbs']),
        livereload()
    ], handleError(done));
}

function css(done) {
    pump([
        src('assets/css/screen.css', {sourcemaps: true}),
        postcss([
            easyimport,
            autoprefixer(),
            cssnano()
        ]),
        dest('assets/built/'),
        livereload()
    ], handleError(done));
}

function js(done) {
    pump([
        src([
            'assets/js/lib/*.js',
            'assets/js/*.js'
        ], {sourcemaps: true}),
        concat('source.js'),
        uglify(),
        dest('assets/built/'),
        livereload()
    ], handleError(done));
}

function fonts(done) {
    const fontSrc = path.join(__dirname, 'assets/fonts');
    const fontDest = path.join(__dirname, 'assets/built/fonts');

    if (fs.existsSync(fontSrc)) {
        if (!fs.existsSync(fontDest)) {
            fs.mkdirSync(fontDest, {recursive: true});
        }
        const files = fs.readdirSync(fontSrc);
        files.forEach((file) => {
            fs.copyFileSync(path.join(fontSrc, file), path.join(fontDest, file));
        });
    }
    done();
}

function zipper(done) {
    const targetDir = 'dist/';
    const themeName = require('./package.json').name;
    const filename = themeName + '.zip';

    if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir);
    }

    pump([
        src([
            '**',
            '!node_modules', '!node_modules/**',
            '!dist', '!dist/**',
            '!yarn-error.log',
            '!yarn.lock',
            '!gulpfile.js',
            '!.git', '!.git/**',
            '!assets/fonts', '!assets/fonts/**'
        ], {encoding: false}), 
        zip(filename),
        dest(targetDir)
    ], handleError(done));
}

const cssWatcher = () => watch('assets/css/**', css);
const jsWatcher = () => watch('assets/js/**', js);
const hbsWatcher = () => watch(['*.hbs', 'partials/**/*.hbs'], hbs);
const fontsWatcher = () => watch('assets/fonts/**', fonts);
const watcher = parallel(cssWatcher, jsWatcher, hbsWatcher, fontsWatcher);

const build = series(css, js, fonts);

exports.build = build;
exports.zip = series(build, zipper);
exports.default = series(build, serve, watcher);

exports.release = async () => {
    let packageJSON = JSON.parse(fs.readFileSync('./package.json'));
    const newVersion = packageJSON.version;
    if (!newVersion) return;
    const githubToken = process.env.GST_TOKEN;
    if (!githubToken) return;

    try {
        const result = await inquirer.prompt([{
            type: 'input',
            name: 'compatibleWithGhost',
            message: 'Ghost Version?',
            default: '5.0.0'
        }]);
        const releasesResponse = await releaseUtils.releases.get({
            userAgent: 'Source',
            uri: `https://api.github.com/repos/${REPO_READONLY}/releases`
        });
        let previousVersion = releasesResponse[0].tag_name || releasesResponse[0].name;
        const changelog = new releaseUtils.Changelog({
            changelogPath: CHANGELOG_PATH,
            folder: path.join(process.cwd(), '.')
        });
        changelog.write({ githubRepoPath: `https://github.com/${REPO}`, lastVersion: previousVersion }).sort().clean();
        await releaseUtils.releases.create({
            draft: true,
            tagName: 'v' + newVersion,
            releaseName: newVersion,
            userAgent: 'Source',
            uri: `https://api.github.com/repos/${REPO}/releases`,
            github: { token: githubToken },
            content: [`**Compatible with Ghost ≥ ${result.compatibleWithGhost}**\n\n`],
            changelogPath: CHANGELOG_PATH
        });
    } catch (err) {
        process.exit(1);
    }
};