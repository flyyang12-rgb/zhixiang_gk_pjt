import argparse
import json
import re
from pathlib import Path

from PIL import Image
from rapidocr_onnxruntime import RapidOCR

ROOT = Path(__file__).resolve().parents[1]
IMAGE_DIR = ROOT / '.scratch' / 'henan-images'
OUTPUT = ROOT / 'data' / 'henan-2025-ocr.json'


def parse_image(path_string: str):
    path = Path(path_string)
    image = Image.open(path).convert('RGB')
    scale = 0.5
    resized = image.resize((int(image.width * scale), int(image.height * scale)))
    result, _ = RapidOCR(use_cls=False)(resized)
    if not result:
        return {'image': path.name, 'rows': []}

    tokens = []
    for box, text, confidence in result:
        left = min(point[0] for point in box) / scale
        right = max(point[0] for point in box) / scale
        top = min(point[1] for point in box) / scale
        bottom = max(point[1] for point in box) / scale
        tokens.append({'x': (left + right) / 2, 'y': (top + bottom) / 2, 'text': text.strip(), 'confidence': confidence})

    clusters = []
    for token in sorted(tokens, key=lambda item: item['y']):
        if not clusters or abs(clusters[-1]['y'] - token['y']) > 18:
            clusters.append({'y': token['y'], 'tokens': [token]})
        else:
            cluster = clusters[-1]
            cluster['tokens'].append(token)
            cluster['y'] = sum(item['y'] for item in cluster['tokens']) / len(cluster['tokens'])

    boundaries = [0, 130, 375, 480, 620, 710, 850, 960, 1055, 1150, 1300]
    parsed = []
    for cluster in clusters:
        columns = ['' for _ in range(10)]
        confidence = [1.0 for _ in range(10)]
        for token in sorted(cluster['tokens'], key=lambda item: item['x']):
            index = next((i for i in range(10) if boundaries[i] <= token['x'] < boundaries[i + 1]), None)
            if index is None:
                continue
            columns[index] += token['text']
            confidence[index] = min(confidence[index], token['confidence'])

        school_name = re.sub(r'^[^\u4e00-\u9fff]+', '', columns[1]).strip()
        group_match = re.search(r'第?\d{2,3}组', columns[5])
        score_match = re.search(r'\d{3}', columns[8])
        rank_match = re.search(r'\d{1,7}', columns[9].replace(',', ''))
        if len(school_name) < 2 or not group_match or not score_match or not rank_match:
            continue
        score = int(score_match.group())
        rank = int(rank_match.group())
        if not 180 <= score <= 750 or rank < 1:
            continue
        parsed.append({
            'schoolCode': re.sub(r'\D', '', columns[0])[:4],
            'schoolName': school_name,
            'schoolTier': columns[2],
            'planType': columns[3],
            'group': group_match.group().replace('第', '').replace('组', ''),
            'requirement': columns[6],
            'enrollmentCount': int(re.sub(r'\D', '', columns[7])) if re.sub(r'\D', '', columns[7]) else None,
            'score': score,
            'rank': rank,
            'confidence': round(min(confidence[1], confidence[5], confidence[8], confidence[9]), 4),
        })
    return {'image': path.name, 'rows': parsed}


def parse_pages(value: str):
    pages = set()
    for part in value.split(','):
        if '-' in part:
            start, end = (int(item) for item in part.split('-', 1))
            pages.update(range(start, end + 1))
        else:
            pages.add(int(part))
    invalid = [page for page in pages if page < 2 or page > 36]
    if invalid:
        raise argparse.ArgumentTypeError('页码必须在 2 到 36 之间')
    return sorted(pages)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='识别河南 2025 本科批投档表镜像图片')
    parser.add_argument('--pages', type=parse_pages, default=parse_pages('2-36'))
    parser.add_argument('--output', type=Path, default=OUTPUT)
    parser.add_argument('--checkpoint-dir', type=Path, default=ROOT / '.scratch' / 'henan-ocr-pages')
    parser.add_argument('--resume', action='store_true')
    args = parser.parse_args()

    pages = []
    args.checkpoint_dir.mkdir(parents=True, exist_ok=True)
    for index in args.pages:
        image_path = IMAGE_DIR / f'{index:02d}.png'
        checkpoint = args.checkpoint_dir / f'{index:02d}.json'
        if args.resume and checkpoint.exists():
            page = json.loads(checkpoint.read_text(encoding='utf-8'))
        else:
            page = parse_image(str(image_path))
            checkpoint.write_text(json.dumps(page, ensure_ascii=False, indent=2), encoding='utf-8')
        pages.append(page)
        print(json.dumps({'page': index, 'rows': len(page['rows'])}, ensure_ascii=False), flush=True)

    records = []
    for page in pages:
        image_number = int(Path(page['image']).stem)
        subject_group = '历史类' if image_number <= 12 else '物理类'
        for row in page['rows']:
            records.append({**row, 'subjectGroup': subject_group, 'image': page['image']})
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'pages': len(pages), 'records': len(records), 'history': sum(item['subjectGroup'] == '历史类' for item in records), 'physics': sum(item['subjectGroup'] == '物理类' for item in records)}, ensure_ascii=False))
