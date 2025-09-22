from typing import Union, Optional
import pandas as pd
from fastapi import FastAPI, Query

app = FastAPI()

# 고객 정보 사전형 데이터
customers = {
    1: {"성명": "김철수", "연령": 35, "주소": "서울시 강남구", "전화번호": "010-1234-5678"},
    2: {"성명": "이영희", "연령": 28, "주소": "부산시 해운대구", "전화번호": "010-2345-6789"},
    3: {"성명": "박민수", "연령": 42, "주소": "대구시 수성구", "전화번호": "010-3456-7890"},
    4: {"성명": "정수진", "연령": 31, "주소": "인천시 연수구", "전화번호": "010-4567-8901"},
    5: {"성명": "최현우", "연령": 26, "주소": "광주시 서구", "전화번호": "010-5678-9012"}
}

# 상품 정보 사전형 데이터
products = {
    1: {"상품명": "노트북", "가격": 1200000, "설명": "고성능 게이밍 노트북", "카테고리": "전자제품"},
    2: {"상품명": "스마트폰", "가격": 800000, "설명": "최신 스마트폰", "카테고리": "전자제품"},
    3: {"상품명": "운동화", "가격": 120000, "설명": "편안한 러닝화", "카테고리": "의류"},
    4: {"상품명": "책상", "가격": 200000, "설명": "인체공학적 책상", "카테고리": "가구"},
    5: {"상품명": "커피머신", "가격": 350000, "설명": "프리미엄 커피머신", "카테고리": "가전제품"}
}

@app.get("/")
def get_all_info():
    """모든 고객과 상품 정보를 조회"""
    return {
        "고객_정보": customers,
        "상품_정보": products,
        "총_고객_수": len(customers),
        "총_상품_수": len(products)
    }

@app.get("/customers")
def get_customers(
    name: Optional[str] = Query(None, description="고객명으로 검색"),
    age_min: Optional[int] = Query(None, description="최소 연령"),
    age_max: Optional[int] = Query(None, description="최대 연령"),
    address: Optional[str] = Query(None, description="주소로 검색")
):
    """고객 정보 검색"""
    result = {}
    
    for customer_id, customer_info in customers.items():
        # 이름 검색
        if name and name not in customer_info["성명"]:
            continue
            
        # 연령 범위 검색
        if age_min and customer_info["연령"] < age_min:
            continue
        if age_max and customer_info["연령"] > age_max:
            continue
            
        # 주소 검색
        if address and address not in customer_info["주소"]:
            continue
            
        result[customer_id] = customer_info
    
    return {
        "검색_결과": result,
        "검색된_고객_수": len(result)
    }

@app.get("/products")
def get_products(
    name: Optional[str] = Query(None, description="상품명으로 검색"),
    price_min: Optional[int] = Query(None, description="최소 가격"),
    price_max: Optional[int] = Query(None, description="최대 가격"),
    category: Optional[str] = Query(None, description="카테고리로 검색")
):
    """상품 정보 검색"""
    result = {}
    
    for product_id, product_info in products.items():
        # 상품명 검색
        if name and name not in product_info["상품명"]:
            continue
            
        # 가격 범위 검색
        if price_min and product_info["가격"] < price_min:
            continue
        if price_max and product_info["가격"] > price_max:
            continue
            
        # 카테고리 검색
        if category and category not in product_info["카테고리"]:
            continue
            
        result[product_id] = product_info
    
    return {
        "검색_결과": result,
        "검색된_상품_수": len(result)
    }

@app.get("/dataframe")
def get_dataframe():
    """데이터프레임을 JSON 형태로 반환"""
    df = pd.DataFrame({'a': [1, 2, 3], 'b': [4, 5, 6]})
    return {
        "dataframe": df.to_dict('records'),
        "columns": df.columns.tolist(),
        "shape": df.shape
    }

@app.get("/dataframe/html")
def get_dataframe_html():
    """데이터프레임을 HTML 테이블로 반환"""
    df = pd.DataFrame({'a': [1, 2, 3], 'b': [4, 5, 6]})
    html_table = df.to_html(classes='table table-striped', table_id='dataframe')
    return f"""
    <!DOCTYPE html>
    <html>
    <head>
        <title>DataFrame</title>
        <style>
            table {{ border-collapse: collapse; width: 100%; }}
            th, td {{ border: 1px solid #ddd; padding: 8px; text-align: left; }}
            th {{ background-color: #f2f2f2; }}
        </style>
    </head>
    <body>
        <h1>DataFrame</h1>
        {html_table}
    </body>
    </html>
    """