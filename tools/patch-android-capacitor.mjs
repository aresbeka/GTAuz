import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ANDROID_DIR = path.join(ROOT_DIR, 'android');

async function patchAndroidManifest() {
  const manifestPath = path.join(ANDROID_DIR, 'app', 'src', 'main', 'AndroidManifest.xml');
  let xml = await fs.readFile(manifestPath, 'utf-8');

  // Enable hardware acceleration and largeHeap for heavy 3D .glb car & campus models
  if (!xml.includes('android:hardwareAccelerated')) {
    xml = xml.replace('<application', '<application\n        android:hardwareAccelerated="true"');
  }
  if (!xml.includes('android:largeHeap')) {
    xml = xml.replace('<application', '<application\n        android:largeHeap="true"');
  }

  // Lock gameplay to ergonomic landscape orientation
  if (!xml.includes('android:screenOrientation')) {
    xml = xml.replace(
      'android:name=".MainActivity"',
      'android:name=".MainActivity"\n            android:screenOrientation="sensorLandscape"'
    );
  }

  await fs.writeFile(manifestPath, xml, 'utf-8');
  console.log('[patch-android] Patched AndroidManifest.xml (landscape + hardwareAccelerated + largeHeap)');
}

async function patchMainActivity() {
  const javaDir = path.join(
    ANDROID_DIR,
    'app',
    'src',
    'main',
    'java',
    'com',
    'pelicancampus',
    'cars'
  );
  const activityPath = path.join(javaDir, 'MainActivity.java');
  try {
    await fs.access(activityPath);
  } catch {
    console.warn('[patch-android] MainActivity.java not found at expected path, skipping fullscreen patch.');
    return;
  }

  const code = `package com.pelicancampus.cars;

import android.graphics.Color;
import android.os.Bundle;
import android.view.WindowManager;
import android.webkit.WebSettings;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        enableImmersiveFullscreen();
    }

    @Override
    public void onStart() {
        super.onStart();
        if (this.bridge != null && this.bridge.getWebView() != null) {
            this.bridge.getWebView().setBackgroundColor(Color.parseColor("#0D1017"));
            WebSettings settings = this.bridge.getWebView().getSettings();
            settings.setDomStorageEnabled(true);
            settings.setJavaScriptEnabled(true);
            settings.setMediaPlaybackRequiresUserGesture(false);
            settings.setAllowFileAccess(true);
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            enableImmersiveFullscreen();
        }
    }

    private void enableImmersiveFullscreen() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        WindowInsetsControllerCompat controller =
            WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        if (controller != null) {
            controller.hide(WindowInsetsCompat.Type.systemBars());
            controller.setSystemBarsBehavior(
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            );
        }
    }
}
`;
  await fs.writeFile(activityPath, code, 'utf-8');
  console.log('[patch-android] Patched MainActivity.java (immersive fullscreen + WebGL hardware layer)');
}

async function patchGradleProperties() {
  const propsPath = path.join(ANDROID_DIR, 'gradle.properties');
  try {
    let props = await fs.readFile(propsPath, 'utf-8');
    if (props.includes('org.gradle.jvmargs=')) {
      props = props.replace(
        /org\.gradle\.jvmargs=.*/g,
        'org.gradle.jvmargs=-Xmx3072m -Dfile.encoding=UTF-8'
      );
    } else {
      props += '\norg.gradle.jvmargs=-Xmx3072m -Dfile.encoding=UTF-8\n';
    }
    await fs.writeFile(propsPath, props, 'utf-8');
    console.log('[patch-android] Patched gradle.properties (-Xmx3072m for 3D .glb assets)');
  } catch {
    // Ignore if missing
  }
}

async function patchAppName() {
  const customName = (process.env.APP_NAME || '').trim();
  if (!customName) return;
  const stringsPath = path.join(ANDROID_DIR, 'app', 'src', 'main', 'res', 'values', 'strings.xml');
  try {
    let xml = await fs.readFile(stringsPath, 'utf-8');
    const escaped = customName
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/'/g, "\\'");
    xml = xml.replace(
      /<string name="app_name">.*?<\/string>/g,
      `<string name="app_name">${escaped}</string>`
    );
    xml = xml.replace(
      /<string name="title_activity_main">.*?<\/string>/g,
      `<string name="title_activity_main">${escaped}</string>`
    );
    await fs.writeFile(stringsPath, xml, 'utf-8');
    console.log(`[patch-android] Applied app_name="${customName}"`);
  } catch {
    // Ignore if missing
  }
}

async function main() {
  await patchAndroidManifest();
  await patchMainActivity();
  await patchGradleProperties();
  await patchAppName();
}

main().catch((err) => {
  console.error('[patch-android] Failed:', err);
  process.exit(1);
});
